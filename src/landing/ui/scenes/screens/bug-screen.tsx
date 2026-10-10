import { motion, AnimatePresence } from 'motion/react'
import { ActivityIcon, LifeBuoyIcon } from 'lucide-react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { BugBadge } from '@newt/ui/domain/bug-badge'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'
import type { Story } from '../../../story'
import { AppWindow } from '../../mock/window'
import { useStepper } from '../../motion/stepper'

export type BugCopy = {
  monitoring: string
  occurrences: (count: number) => string
  groupedInto: string
  breaks: string
  neverReaches: string
  workaround: string
}

const bars = [3, 5, 4, 8, 6, 9, 12, 10, 14, 11, 16, 13, 18, 15]

/** New crashes keep arriving and fold into the same bug as occurrences. */
export function BugScreen({ copy, bug }: { copy: BugCopy; bug: Story['bug'] }) {
  const { ref, step } = useStepper(4, { interval: 1300, hold: 2 })
  const count = bug.occurrences - 3 + step
  return (
    <div ref={ref}>
      <AppWindow crumbs={['acme-shop', 'Bugs', bug.id]} bodyClassName="p-3 text-[11px]">
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm leading-snug font-medium">{bug.title}</div>
          <BugBadge state="confirmed" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {bug.scope.map(s => {
            const [n, v] = s.split(': ')
            return <DimensionChip key={s} name={n!} value={v!} />
          })}
        </div>
        <div className="mt-3 rounded-md border bg-card p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-muted-foreground">
              <ActivityIcon aria-hidden className="size-3" /> {copy.monitoring}
            </span>
            <motion.span key={count} initial={{ scale: 1.35, color: 'var(--bad)' }} animate={{ scale: 1, color: 'var(--foreground)' }} className="font-mono font-semibold">
              {copy.occurrences(count)}
            </motion.span>
          </div>
          <div className="mt-2 flex h-12 items-end gap-1" aria-hidden>
            {bars.map((h, i) => (
              <motion.span
                key={i}
                className="flex-1 rounded-sm bg-bad/60"
                initial={{ height: 2 }}
                whileInView={{ height: `${(h + (i === bars.length - 1 ? step * 2 : 0)) * 5}%` }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04 }}
              />
            ))}
          </div>
          <div className="relative mt-2 h-6 overflow-hidden">
            <AnimatePresence>
              <motion.div
                key={step}
                initial={{ x: 120, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ y: -16, opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.45 }}
                className="absolute inset-x-0 truncate rounded border border-dashed px-2 py-0.5 font-mono text-[10px] whitespace-nowrap text-muted-foreground"
              >
                crash · iOS 26.1 · BizumConfirm.timeout → {copy.groupedInto} {bug.id}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-muted-foreground">{copy.breaks}</span>
          <ArtifactTag kind={bug.violates.kind} id={bug.violates.id} />
          <span className="text-muted-foreground">{copy.neverReaches}</span>
        </div>
        <div className="mt-2 flex gap-1.5 rounded-md bg-info/10 p-2 text-info">
          <LifeBuoyIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span>
            <b>{copy.workaround}</b> {bug.workaround}
          </span>
        </div>
      </AppWindow>
    </div>
  )
}
