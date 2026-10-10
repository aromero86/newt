import { AnimatePresence, motion } from 'motion/react'
import { ActivityIcon, CheckIcon, GitPullRequestIcon, MinusIcon } from 'lucide-react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { BugBadge } from '@newt/ui/domain/bug-badge'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { Lang } from '../../../i18n'
import type { Story } from '../../../story'
import { ease, useStepper } from '../../motion/stepper'
import { InfoCard, StepDots, type CardCopy } from './card'
import { CountUp } from '@newt/ui/components/count-up'

export type BugsVsProposalsCopy = CardCopy & {
  occurrences: string
  breaks: string
  fixPrTitle: string
  resolves: (bugId: string) => string
  correctionTitle: string
  /** The rows of the comparison table, in the order of `compare`. */
  compareRows: string[]
  yes: string
}

/** Which of the comparison's rows hold for a bug and for a proposal. */
const compare: { bug: boolean; proposal: boolean }[] = [
  { bug: false, proposal: true }, // changes the definition
  { bug: false, proposal: true }, // has deltas
  { bug: false, proposal: true }, // goes through the gate
  { bug: true, proposal: true }, // linked to artifacts
]

export function BugsVsProposals({ copy, story, lang }: { copy: BugsVsProposalsCopy; story: Story; lang: Lang }) {
  const { bug } = story
  const { ref, step, setStep } = useStepper(copy.steps.length, { interval: 2600 })

  return (
    <InfoCard stepperRef={ref} index={6} title={copy.title} lead={copy.lead} caption={copy.steps[step]} captionKey={step}>
      {/* The bug's journey */}
      <div className="rounded-xl border bg-background/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{bug.id}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={step < 1 ? 'r' : step < 2 ? 'c' : 'x'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <BugBadge state={step === 0 ? 'reported' : step === 2 ? 'resolved' : 'confirmed'} />
            </motion.span>
          </AnimatePresence>
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <ActivityIcon className="size-3" /> <CountUp to={bug.occurrences} run duration={2.2} locale={lang === 'es' ? 'es-ES' : 'en-US'} /> {copy.occurrences}
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-snug">{bug.title}</p>

        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
          <AnimatePresence>
            {step >= 1 && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                {copy.breaks} <ArtifactTag kind={bug.violates.kind} id={bug.violates.id} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* How it gets resolved */}
        <div className="mt-2 min-h-[2.4rem]">
          <AnimatePresence mode="wait" initial={false}>
            {step === 2 && (
              <motion.div
                key="pr"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease }}
                className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/8 px-2.5 py-1.5 text-[11px]"
              >
                <GitPullRequestIcon className="size-3.5 shrink-0 text-ok" />
                <span>
                  <span className="font-mono">PR #326</span> {copy.fixPrTitle} → <span className="text-ok">{copy.resolves(bug.id)}</span>
                </span>
              </motion.div>
            )}
            {step === 3 && (
              <motion.div
                key="prop"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.35, ease }}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/8 px-2.5 py-1.5 text-[11px]"
              >
                <span className="font-mono">PROP-47</span> {copy.correctionTitle}
                <ProposalBadge state="in review" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bug vs proposal, side by side */}
      <table className="mt-3 w-full text-left text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 font-normal" />
            <th className="w-16 py-1 text-center font-medium">Bug</th>
            <th className="w-16 py-1 text-center font-medium">Proposal</th>
          </tr>
        </thead>
        <tbody>
          {compare.map((row, i) => (
            <tr key={i} className="border-t">
              <td className="py-1 pr-2 text-foreground/85">{copy.compareRows[i]}</td>
              <td className="text-center">
                <Mark yes={row.bug} label={copy.yes} />
              </td>
              <td className="text-center">
                <Mark yes={row.proposal} label={copy.yes} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <StepDots count={copy.steps.length} step={step} onPick={setStep} label={copy.stepLabel} />
    </InfoCard>
  )
}

function Mark({ yes, label }: { yes: boolean; label: string }) {
  return yes ? (
    <CheckIcon className="mx-auto size-3.5 text-ok" aria-label={label} />
  ) : (
    <MinusIcon className="mx-auto size-3.5 text-muted-foreground/60" aria-label="no" />
  )
}
