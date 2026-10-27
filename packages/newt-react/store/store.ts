import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals-core'

/**
 * A service's state, in one signal. `select` hands out a read-only part of it, so a
 * component that reads `items` does not repaint when `loading` changes.
 */
export class Store<STATE extends object> {

  private readonly initial: STATE
  private readonly state: Signal<STATE>

  constructor(initial: STATE) {
    this.initial = initial
    this.state = signal(initial)
  }

  /** The whole state right now, without subscribing to it. */
  get value(): STATE {
    return this.state.peek()
  }

  select<K extends keyof STATE>(key: K): ReadonlySignal<STATE[K]> {
    return computed(() => this.state.value[key])
  }

  patch(change: Partial<STATE>): void {
    this.state.value = { ...this.state.peek(), ...change }
  }

  update(change: (state: STATE) => Partial<STATE>): void {
    const current = this.state.peek()
    this.state.value = { ...current, ...change(current) }
  }

  reset(): void {
    this.state.value = this.initial
  }
}
