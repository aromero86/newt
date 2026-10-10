import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2Icon, ScanSearchIcon, XCircleIcon } from 'lucide-react'
import { cn } from 'cn'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { Story } from '../../../story'
import { ease, useStepper } from '../../motion/stepper'
import { InfoCard, StepDots } from './card'

export type GateCopy = {
  title: string
  lead: string
  stepLabel: (i: number, count: number) => string
  /** The names of the definition's blocks, in the order of `dotsPerBlock`. */
  blocks: string[]
  /** Caption while the first blocks are swept. */
  checking: (proposalId: string, block: string) => string
  /** Caption when the conflict shows up. */
  conflict: (explanation: string) => string
  /** Caption while the remaining blocks are swept. */
  stillChecking: (block: string) => string
  revision2: string
  noConflicts: string
  resolved: string
}

/**
 * The definition, split in blocks by area. Each dot is an artifact. The gate
 * sweeps every block: nothing is left out. `conflictAt` marks R-07's dot.
 */
const dotsPerBlock: { dots: number; conflictAt?: number }[] = [
  { dots: 34 },
  { dots: 26 },
  { dots: 38, conflictAt: 21 },
  { dots: 31 },
  { dots: 22 },
  { dots: 29 },
]
const TOTAL = dotsPerBlock.reduce((n, b) => n + b.dots, 0)

const SWEEP = dotsPerBlock.length // steps 0..5 sweep each block
const STEPS = SWEEP + 2

export function Gate({ copy, story }: { copy: GateCopy; story: Story }) {
  const { conflict, deltas, proposal } = story
  const blocks = dotsPerBlock.map((b, i) => ({ ...b, name: copy.blocks[i]! }))
  const steps: string[] = [
    ...blocks.map((b, i) =>
      i < 2 ? copy.checking(proposal.id, b.name) : i === 2 ? copy.conflict(conflict.explanation) : copy.stillChecking(b.name),
    ),
    copy.revision2,
    copy.noConflicts,
  ]
  const { ref, step, setStep } = useStepper(STEPS, { interval: 1700, hold: 3 })
  const sweeping = step < SWEEP ? step : -1
  const conflictFound = step >= 2
  const fixed = step >= SWEEP
  const accepted = step === steps.length - 1
  const checked = fixed ? 1 : (step + 0.5) / SWEEP

  return (
    <InfoCard stepperRef={ref} index={2} title={copy.title} lead={copy.lead} caption={steps[step]} captionKey={step}>
      {/* The proposal's deltas, the thing being checked */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] text-muted-foreground">{proposal.id}</span>
        {deltas.map(d => {
          const bad = d.id === conflict.delta && conflictFound && !fixed
          const redone = d.id === conflict.delta && fixed
          return (
            <span
              key={d.id}
              className={cn(
                'rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors duration-500',
                bad ? 'border-bad/50 bg-bad/15 text-bad' : redone ? 'border-ok/50 bg-ok/12 text-ok' : 'bg-background/60 text-foreground/80',
              )}
            >
              {d.id}
            </span>
          )
        })}
        <span className="ml-auto">
          <AnimatePresence mode="wait" initial={false}>
            {accepted ? (
              <motion.span key="acc" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <ProposalBadge state="accepted" />
              </motion.span>
            ) : (
              <motion.span key="rev" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ProposalBadge state="in review" />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </div>

      {/* The whole definition, by blocks */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {blocks.map((block, i) => {
          const active = sweeping === i
          const done = sweeping === -1 || i < sweeping
          return (
            <div
              key={i}
              className={cn(
                'relative overflow-hidden rounded-lg border p-2 transition-colors duration-300',
                active ? 'border-brand/60 bg-brand/10' : 'bg-background/50',
              )}
            >
              {active && (
                <motion.div
                  aria-hidden
                  className="absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-brand/30 to-transparent"
                  initial={{ left: '-20%' }}
                  animate={{ left: '110%' }}
                  transition={{ duration: 1.4, ease: 'linear' }}
                />
              )}
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <p className="truncate text-[11px] font-medium">{block.name}</p>
                {done && !active && <CheckCircle2Icon className="size-3 shrink-0 text-ok/80" />}
                {active && <ScanSearchIcon className="size-3 shrink-0 text-brand" />}
              </div>
              <div className="flex flex-wrap gap-1 lg:gap-1.5">
                {Array.from({ length: block.dots }, (_, d) => {
                  const lit = block.conflictAt === d && conflictFound
                  return (
                    <span
                      key={d}
                      className={cn(
                        'size-2 rounded-[3px] transition-all duration-500 lg:size-2.5',
                        lit && !fixed && 'scale-150 bg-bad ring-2 ring-bad/40',
                        lit && fixed && 'bg-ok',
                        !lit && (done || active ? 'bg-muted-foreground/40' : 'bg-muted-foreground/15'),
                      )}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* How much has been checked: all of it, always */}
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
            animate={{ width: `${checked * 100}%` }}
            transition={{ duration: 0.8, ease }}
          />
        </div>
        <span className="font-mono text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {Math.round(checked * TOTAL)} / {TOTAL} artifacts
        </span>
      </div>

      {/* The conflict, explained next to its delta */}
      <div className="mt-3 min-h-[3.25rem]">
        <AnimatePresence mode="wait" initial={false}>
          {conflictFound && (
            <motion.div
              key={fixed ? 'fixed' : 'open'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease }}
              className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-xs', fixed ? 'border-ok/40 bg-ok/8' : 'border-bad/40 bg-bad/8')}
            >
              {fixed ? (
                <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-ok" />
              ) : (
                <XCircleIcon className="mt-0.5 size-3.5 shrink-0 text-bad" />
              )}
              <span>
                <span className="font-mono">{conflict.delta}</span> × <span className="font-mono">{conflict.with.id}</span>{' '}
                {fixed ? copy.resolved : `— ${conflict.with.text}`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <StepDots count={steps.length} step={step} onPick={setStep} label={copy.stepLabel} />
    </InfoCard>
  )
}
