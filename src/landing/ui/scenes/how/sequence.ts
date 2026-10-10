import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * Plays a one-shot sequence when a stage mounts: 0, 1, 2 … count-1 at the given
 * times (ms from mount). Reduced motion jumps straight to the end.
 */
export function useSequence(times: number[]) {
  const reduced = useReducedMotion()
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (reduced) return
    const ids = times.map((t, i) => setTimeout(() => setAt(i + 1), t))
    return () => ids.forEach(clearTimeout)
    // times is a literal per stage: run once on mount
  }, [reduced])
  return reduced ? times.length : at
}
