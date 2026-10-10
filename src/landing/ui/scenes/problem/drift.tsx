import { motion } from 'motion/react'
import { useStepper } from '../../motion/stepper'

/** Two lines leave the same point and grow apart. */
export function Drift({ copy }: { copy: { docs: string; code: string } }) {
  const { ref, step } = useStepper(2, { interval: 2600, hold: 1 })
  return (
    <div ref={ref} className="absolute inset-0">
      <svg viewBox="0 0 300 170" className="size-full">
        <motion.path
          d="M20 85 C 110 85, 160 85, 280 40"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: step === 1 ? 1 : 0.35 }}
          transition={{ duration: 1.4, ease: 'easeInOut' }}
        />
        <motion.path
          d="M20 85 C 110 85, 160 85, 280 130"
          fill="none"
          stroke="var(--bad)"
          strokeWidth="2.5"
          strokeDasharray="6 6"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: step === 1 ? 1 : 0.35 }}
          transition={{ duration: 1.4, ease: 'easeInOut' }}
        />
        <circle cx="20" cy="85" r="5" fill="var(--foreground)" />
        <motion.text x="196" y="30" className="fill-brand text-[11px]" animate={{ opacity: step === 1 ? 1 : 0 }}>
          {copy.docs}
        </motion.text>
        <motion.text x="196" y="152" className="fill-bad text-[11px]" animate={{ opacity: step === 1 ? 1 : 0 }}>
          {copy.code}
        </motion.text>
      </svg>
    </div>
  )
}
