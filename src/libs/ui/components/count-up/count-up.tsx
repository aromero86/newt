import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'motion/react'

type CountUpProps = {
  to: number
  /** Counts while true; back to 0 when it turns false. */
  run: boolean
  /** How the number is written, e.g. `es-ES` (1.284) or `en-US` (1,284). */
  locale: string
  /** Seconds. */
  duration?: number
}

/** A number that counts up from 0. It shows the final number at once with reduced motion. */
export function CountUp({ to, run, locale, duration = 1.4 }: CountUpProps) {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(reduced && run ? to : 0)

  useEffect(() => {
    if (!run) {
      setValue(0)
      return
    }
    if (reduced) {
      setValue(to)
      return
    }
    const controls = animate(0, to, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: v => setValue(Math.round(v)) })
    return () => controls.stop()
  }, [run, to, duration, reduced])

  return <span className="tabular-nums">{value.toLocaleString(locale)}</span>
}
