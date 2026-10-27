import type { ReadonlySignal } from '@preact/signals-core'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Reads a signal in render and repaints the component when, and only when, it changes.
 * Rendered to HTML (a test, a server), it reads the signal as it is.
 */
export function useValue<T>(source: ReadonlySignal<T>): T {
  const subscribe = useCallback((onChange: () => void) => source.subscribe(() => onChange()), [source])
  const read = () => source.peek()
  return useSyncExternalStore(subscribe, read, read)
}
