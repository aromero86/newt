import type { ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { GitMergeIcon, GitPullRequestIcon } from 'lucide-react'
import { cn } from 'cn'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { Story } from '../../../story'
import { ease, useStepper } from '../../motion/stepper'
import { InfoCard, StepDots, type CardCopy } from './card'

export type CurrentVsPlannedCopy = CardCopy & {
  current: string
  currentHint: string
  planned: string
  plannedHint: string
  everythingPlus: string
  nothingPending: string
}

/** Current (merged) vs planned (+ accepted) definition, and PROP-42 moving across. */
export function CurrentVsPlanned({ copy, story }: { copy: CurrentVsPlannedCopy; story: Story }) {
  const { pr, rules, proposal } = story
  const { ref, step, setStep } = useStepper(copy.steps.length, { interval: 2600 })
  const merged = step >= 2
  const chip = (state: 'accepted' | 'merged') => <ProposalChip state={state} id={proposal.id} title={proposal.title} />

  return (
    <InfoCard stepperRef={ref} index={1} title={copy.title} lead={copy.lead} caption={copy.steps[step]} captionKey={step}>
      <LayoutGroup>
        <div className="grid grid-cols-2 gap-3">
          <Column title={copy.current} hint={copy.currentHint} tone="current">
            <RuleRow id={rules.paidOrderImmutable.id} text={rules.paidOrderImmutable.text} />
            <RuleRow id={rules.freeShipping.id} text={rules.freeShipping.text} />
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={merged ? 'new' : 'old'}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.4, ease }}
              >
                <RuleRow
                  id={rules.guestsCannotPay.id}
                  text={merged ? rules.guestsPayBizum.text : rules.guestsCannotPay.text}
                  changed={merged}
                />
              </motion.div>
            </AnimatePresence>
            {merged && chip('merged')}
          </Column>

          <Column title={copy.planned} hint={copy.plannedHint} tone="planned">
            <p className="text-[11px] text-muted-foreground">{copy.everythingPlus}</p>
            {!merged ? (
              chip('accepted')
            ) : (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-lg border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground"
              >
                {copy.nothingPending}
              </motion.p>
            )}
          </Column>
        </div>
      </LayoutGroup>

      <div className="mt-3 flex h-6 items-center justify-center">
        <AnimatePresence>
          {step >= 1 && (
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]',
                merged ? 'border-[#8250df]/40 bg-[#8250df]/15 text-[#a371f7]' : 'border-ok/40 bg-ok/12 text-ok',
              )}
            >
              {merged ? <GitMergeIcon className="size-3" /> : <GitPullRequestIcon className="size-3" />}
              PR #{pr.number} {merged ? 'merged' : 'open'}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <StepDots count={copy.steps.length} step={step} onPick={setStep} label={copy.stepLabel} />
    </InfoCard>
  )
}

function Column({ title, hint, tone, children }: { title: string; hint: string; tone: 'current' | 'planned'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border p-3',
        tone === 'current' ? 'bg-background/50' : 'border-dashed border-brand/40 bg-brand/5',
      )}
    >
      <div className="mb-0.5">
        <p className="text-sm font-semibold">{title}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function RuleRow({ id, text, changed }: { id: string; text: string; changed?: boolean }) {
  return (
    <div className={cn('rounded-md border bg-card px-2 py-1.5 transition-colors duration-500', changed && 'border-[#8250df]/40 bg-[#8250df]/10')}>
      <span className="font-mono text-[10px] text-brand">{id}</span>
      <p className="text-[11px] leading-snug text-foreground/85">{text}</p>
    </div>
  )
}

function ProposalChip({ state, id, title }: { state: 'accepted' | 'merged'; id: string; title: string }) {
  return (
    <motion.div
      layoutId="prop-42-chip"
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      className="rounded-lg border bg-card px-2 py-2 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{id}</span>
        <ProposalBadge state={state} />
      </div>
      <p className="mt-1 text-[11px] leading-snug">{title}</p>
    </motion.div>
  )
}
