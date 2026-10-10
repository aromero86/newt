import { motion } from 'motion/react'
import { GitPullRequestIcon } from 'lucide-react'
import { Avatar } from '@newt/ui/components/avatar'
import { useStepper } from '../../motion/stepper'

export type QueueCopy = { prs: string[]; reviewer: string; waiting: string }

/** Pull requests pile up in front of one reviewer. */
export function Queue({ copy, reviewer }: { copy: QueueCopy; reviewer: string }) {
  const { ref, step } = useStepper(copy.prs.length, { interval: 700, hold: 3 })
  return (
    <div ref={ref} className="absolute inset-0 flex items-center gap-4 px-5">
      <div className="flex flex-1 flex-col gap-1.5">
        {copy.prs.slice(0, step + 1).map((title, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-[10px]"
          >
            <GitPullRequestIcon className="size-3 text-ok" />
            <span className="truncate">{title}</span>
            <span className="ml-auto font-mono text-muted-foreground">#{311 + i}</span>
          </motion.div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
        <Avatar name={reviewer} size={9} />
        <span>{copy.reviewer}</span>
        <motion.span className="font-mono text-bad" key={step} initial={{ scale: 1.4 }} animate={{ scale: 1 }}>
          {step + 1} {copy.waiting}
        </motion.span>
      </div>
    </div>
  )
}
