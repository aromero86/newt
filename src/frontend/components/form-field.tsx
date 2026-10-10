import { Field } from '@newt/ui/components/field'
import { Input } from '@newt/ui/components/input'
import { Textarea } from '@newt/ui/components/textarea'
import type { FormStore } from '../core/form/form-store'
import { useValue } from '../core/store/use-value'

type FormFieldProps<TValues extends Record<string, string>> = {
  form: FormStore<TValues, unknown>
  name: keyof TValues & string
  label: string
  description?: string
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  /** A textarea with this many rows, instead of a single line. */
  rows?: number
}

/** A labelled field bound to one value of a form: it shows the value and its error. */
export function FormField<TValues extends Record<string, string>>({ form, name, label, description, type = 'text', autoComplete, rows }: FormFieldProps<TValues>) {
  const value = useValue(form.value(name))
  const error = useValue(form.error(name))
  const onChange = (next: string) => form.set(name, next as TValues[typeof name])

  return (
    <Field label={label} description={description} error={error}>
      {rows === undefined
        ? <Input name={name} type={type} autoComplete={autoComplete} value={value} onChange={onChange} invalid={error !== undefined} />
        : <Textarea name={name} rows={rows} value={value} onChange={onChange} invalid={error !== undefined} />}
    </Field>
  )
}
