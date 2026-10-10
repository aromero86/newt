import { AnimatePresence, motion } from 'motion/react'
import { FileTextIcon } from 'lucide-react'
import { cn } from 'cn'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { DeltaState, Story } from '../../../story'
import { ease, useStepper } from '../../motion/stepper'
import { InfoCard, StepDots, type CardCopy } from './card'

export type ViewedDeltasCopy = CardCopy & { changedSinceApproval: string }

/** Revision 2 rewrites the payment paragraph: only Δ1 changes. */
const changedInR2 = 'Δ1'

export function ViewedDeltas({ copy, story }: { copy: ViewedDeltasCopy; story: Story }) {
  const { deltas, proposal, rules } = story
  const { ref, step, setStep } = useStepper(copy.steps.length, { interval: 2600 })

  const stateOf = (id: string): DeltaState => {
    if (step === 0) return 'pending'
    if (step === 2 && id === changedInR2) return 'pending'
    return 'approved'
  }

  return (
    <InfoCard stepperRef={ref} index={3} title={copy.title} lead={copy.lead} caption={copy.steps[step]} captionKey={step}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <FileTextIcon className="size-3.5 text-muted-foreground" />
        <span className="font-mono text-muted-foreground">{proposal.id}</span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={step >= 2 ? 'r2' : 'r1'}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="rounded-md border bg-background/60 px-1.5 py-0.5 font-mono"
          >
            revision {step >= 2 ? 2 : 1}
          </motion.span>
        </AnimatePresence>
        <span className="ml-auto">
          <ProposalBadge state="in review" />
        </span>
      </div>

      <ul className="space-y-1.5">
        {deltas.map((d, i) => {
          const state = stateOf(d.id)
          const changed = d.id === changedInR2 && step >= 2
          return (
            <motion.li
              key={d.id}
              layout
              className={cn(
                'rounded-lg border px-2.5 py-1.5 transition-colors duration-500',
                changed && step === 2 ? 'border-warn/50 bg-warn/8' : 'bg-background/50',
              )}
            >
              <div className="flex items-center gap-2">
                <motion.span
                  aria-hidden
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-300',
                    state === 'approved' ? 'border-ok bg-ok' : 'border-muted-foreground/40',
                  )}
                  animate={state === 'approved' ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                  transition={{ duration: 0.35, delay: step === 1 ? i * 0.18 : 0 }}
                >
                  {state === 'approved' && (
                    <svg viewBox="0 0 12 12" className="size-2.5 text-background">
                      <path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </motion.span>
                <span className="font-mono text-[11px]">{d.id}</span>
                <ArtifactTag kind={d.kind} id={d.artifact} />
                <span className="ml-auto">
                  <DeltaBadge state={state} />
                </span>
              </div>
              <AnimatePresence initial={false}>
                {changed && step === 2 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease }}
                    className="overflow-hidden"
                  >
                    <p className="mt-1.5 text-[11px] leading-snug">
                      <span className="text-bad line-through decoration-bad/60">{d.after}</span>
                      <br />
                      <span className="text-ok">{rules.guestsPayBizum.text}</span>
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-warn">{copy.changedSinceApproval}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          )
        })}
      </ul>
      <StepDots count={copy.steps.length} step={step} onPick={setStep} label={copy.stepLabel} />
    </InfoCard>
  )
}
