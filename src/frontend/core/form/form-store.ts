import { computed, type ReadonlySignal } from '@preact/signals-core'
import type { z } from 'zod'
import { ApiError } from '@newt/api/core/api-error'
import { Store } from '../store/store'

type FormState<TValues> = {
  values: TValues
  errors: Partial<Record<keyof TValues, string>>
  /** A failure that belongs to no single field. */
  failure: string | null
  submitting: boolean
}

type FormOptions<TValues> = {
  /** Backend error codes that belong to a field: `{ 'user.nick_taken': 'nick' }`. */
  errorFields?: Record<string, keyof TValues>
}

/**
 * A form's values, errors and submission, validated with the same zod schema the
 * backend uses. A service owns it; fields read their part with `value` and `error`.
 */
export class FormStore<TValues extends Record<string, string>, TOutput> {

  private readonly store: Store<FormState<TValues>>
  private readonly cache = new Map<string, ReadonlySignal<unknown>>()

  readonly submitting
  readonly failure
  private readonly values
  private readonly errors

  constructor(
    private readonly schema: z.ZodType<TOutput>,
    initial: TValues,
    private readonly options: FormOptions<TValues> = {},
  ) {
    this.store = new Store<FormState<TValues>>({ values: initial, errors: {}, failure: null, submitting: false })
    this.submitting = this.store.select('submitting')
    this.failure = this.store.select('failure')
    this.values = this.store.select('values')
    this.errors = this.store.select('errors')
  }

  /** One field's value. Cached, so asking for it in render subscribes once. */
  value<K extends keyof TValues>(field: K): ReadonlySignal<TValues[K]> {
    return this.cached(`value:${String(field)}`, () => computed(() => this.values.value[field])) as ReadonlySignal<TValues[K]>
  }

  /** One field's error, if it has one. */
  error(field: keyof TValues): ReadonlySignal<string | undefined> {
    return this.cached(`error:${String(field)}`, () => computed(() => this.errors.value[field])) as ReadonlySignal<string | undefined>
  }

  set<K extends keyof TValues>(field: K, value: TValues[K]): void {
    this.store.update(state => ({ values: { ...state.values, [field]: value }, errors: { ...state.errors, [field]: undefined } }))
  }

  /** Starts over with these values. */
  reset(values: TValues): void {
    this.store.patch({ values, errors: {}, failure: null, submitting: false })
  }

  /**
   * Validates, then runs `action` with the parsed values. Field errors come from the
   * schema or from backend codes listed in `errorFields`. Resolves to whether it
   * succeeded.
   */
  async submit(action: (data: TOutput) => Promise<void>): Promise<boolean> {
    const parsed = this.schema.safeParse(this.store.value.values)
    if (!parsed.success) {
      const errors: Partial<Record<keyof TValues, string>> = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof TValues | undefined
        if (field !== undefined && errors[field] === undefined) errors[field] = issue.message
      }
      this.store.patch({ errors, failure: null })
      return false
    }

    this.store.patch({ submitting: true, failure: null })
    try {
      await action(parsed.data)
      return true
    } catch (error) {
      const field = error instanceof ApiError && error.code ? this.options.errorFields?.[error.code] : undefined
      if (field !== undefined) this.store.update(state => ({ errors: { ...state.errors, [field]: (error as ApiError).message } }))
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Something went wrong' })
      return false
    } finally {
      this.store.patch({ submitting: false })
    }
  }

  private cached(key: string, build: () => ReadonlySignal<unknown>): ReadonlySignal<unknown> {
    if (!this.cache.has(key)) this.cache.set(key, build())
    return this.cache.get(key)!
  }
}
