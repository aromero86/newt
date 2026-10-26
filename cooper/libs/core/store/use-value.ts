import type { ReadonlySignal } from '@preact/signals-core'
import { useCallback, useSyncExternalStore } from 'react'

/** Reads a signal in render and repaints the component when, and only when, it changes. */
export function useValue<T>(source: ReadonlySignal<T>): T {
  const subscribe = useCallback((onChange: () => void) => source.subscribe(() => onChange()), [source])
  return useSyncExternalStore(subscribe, () => source.peek())
}
