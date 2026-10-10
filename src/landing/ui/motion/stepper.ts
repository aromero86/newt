import { useEffect, useRef, useState } from 'react'
import { useInView, useReducedMotion } from 'motion/react'

/**
 * Drives a scripted animation: advances through `count` steps while the element
 * is on screen, looping. With reduced motion it shows the final step and only
 * moves when the visitor picks a step.
 */
export function useStepper(count: number, { interval = 2400, loop = true, hold = 2 } = {}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.35 })
  const reduced = useReducedMotion()
  // With reduced motion: start on the final step and never advance on its own,
  // but still let the visitor step through by hand (setStep).
  const [step, setStep] = useState(() => (reduced ? count - 1 : 0))

  useEffect(() => {
    if (reduced) setStep(count - 1)
  }, [reduced, count])

  useEffect(() => {
    if (reduced || !inView) return
    // The last step stays up a little longer before starting over.
    const wait = step === count - 1 ? interval * hold : interval
    const id = setTimeout(() => {
      setStep(s => (s + 1 < count ? s + 1 : loop ? 0 : s))
    }, wait)
    return () => clearTimeout(id)
  }, [step, inView, reduced, count, interval, loop, hold])

  return { ref, step, setStep, reduced: !!reduced }
}

export const ease = [0.22, 1, 0.36, 1] as const

/** Fade-up used for content entering the screen. */
export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
}
