import { motion } from 'motion/react'
import { cn } from 'cn'
import { useStepper } from '../../motion/stepper'

export type ClashCopy = {
  rule: { when: string; text: string }
  ticket: { when: string; text: string }
  found: string
}

/** Two rules slide in and collide. */
export function Clash({ copy }: { copy: ClashCopy }) {
  const { ref, step } = useStepper(3, { interval: 1500, hold: 2 })
  const hit = step >= 1
  const note = cn('w-36 rounded-lg border bg-card p-2.5 text-[11px] shadow-sm', step === 2 && 'border-bad/60')
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center gap-1 px-4">
      <motion.div animate={{ x: hit ? 6 : -30, rotate: hit ? -2 : 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }} className={note}>
        <div className="font-mono text-[10px] text-muted-foreground">rule R-07 · {copy.rule.when}</div>
        {copy.rule.text}
      </motion.div>
      <motion.div animate={{ x: hit ? -6 : 30, rotate: hit ? 2 : 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }} className={note}>
        <div className="font-mono text-[10px] text-muted-foreground">ticket · {copy.ticket.when}</div>
        {copy.ticket.text}
      </motion.div>
      <motion.span
        className="absolute rounded-full bg-bad px-2 py-0.5 text-[10px] font-semibold text-white"
        animate={{ opacity: step === 2 ? 1 : 0, scale: step === 2 ? 1 : 0.6, y: 52 }}
      >
        {copy.found}
      </motion.span>
    </div>
  )
}
