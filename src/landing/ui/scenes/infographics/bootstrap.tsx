import { AnimatePresence, motion } from 'motion/react'
import { ArrowRightIcon, FileCode2Icon, FolderGit2Icon, SparklesIcon } from 'lucide-react'
import { cn } from 'cn'
import { ArtifactKindLabel } from '@newt/ui/domain/artifact-tag'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { Lang } from '../../../i18n'
import type { ArtifactKind } from '../../../story'
import { ease, useStepper } from '../../motion/stepper'
import { InfoCard, StepDots, type CardCopy } from './card'
import { CountUp } from '@newt/ui/components/count-up'

export type BootstrapCopy = CardCopy & { proposalName: string; mergedNote: string }

const files = [
  'src/checkout/payment.ts',
  'src/orders/order.model.ts',
  'src/orders/status.ts',
  'src/auth/guards.ts',
  'config/shipping.yml',
  'src/catalog/search.ts',
]

/** What Claude finds in Acme Shop's codebase. */
// Product vocabulary: the same word in both languages.
const found: { kind: ArtifactKind; label: string; count: number }[] = [
  { kind: 'feature', label: 'features', count: 24 },
  { kind: 'entity', label: 'entities', count: 31 },
  { kind: 'lifecycle', label: 'lifecycles', count: 9 },
  { kind: 'actor', label: 'actors', count: 5 },
  { kind: 'rule', label: 'rules', count: 412 },
  { kind: 'parameter', label: 'parameters', count: 38 },
]


export function Bootstrap({ copy, lang }: { copy: BootstrapCopy; lang: Lang }) {
  const { ref, step, setStep } = useStepper(copy.steps.length, { interval: 2400 })

  return (
    <InfoCard stepperRef={ref} index={4} title={copy.title} lead={copy.lead} caption={copy.steps[step]} captionKey={step}>
      <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
        {/* The repository, read file by file */}
        <div className="rounded-xl border bg-background/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
            <FolderGit2Icon className="size-3.5 text-muted-foreground" /> acme/shop
          </p>
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li key={f} className="flex items-center gap-1.5 font-mono text-[10px]">
                <FileCode2Icon className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">{f}</span>
                {step === 1 && (
                  <motion.span
                    aria-hidden
                    className="ml-auto size-1.5 shrink-0 rounded-full bg-brand"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 0.4] }}
                    transition={{ delay: i * 0.25, duration: 0.6 }}
                  />
                )}
                {step >= 2 && <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-ok/70" />}
              </li>
            ))}
          </ul>
        </div>

        {/* Claude in the middle */}
        <div className="flex items-center justify-center gap-1 py-1 sm:flex-col">
          <ArrowRightIcon className={cn('size-4 rotate-90 text-muted-foreground transition-colors sm:rotate-0', step >= 1 && 'text-brand')} />
          <motion.div
            animate={step === 1 ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={{ duration: 1.2, repeat: step === 1 ? Infinity : 0 }}
            className={cn('flex size-9 items-center justify-center rounded-full border bg-card', step >= 1 && 'border-brand/50 ring-4 ring-brand/15')}
          >
            <SparklesIcon className="size-4 text-brand" />
          </motion.div>
          <span className="font-mono text-[10px] text-muted-foreground">Claude</span>
          <ArrowRightIcon className={cn('size-4 rotate-90 text-muted-foreground transition-colors sm:rotate-0', step >= 2 && 'text-brand')} />
        </div>

        {/* The bootstrap proposal */}
        <div className={cn('rounded-xl border p-3 transition-colors duration-500', step >= 2 ? 'border-brand/40 bg-brand/5' : 'border-dashed bg-background/30')}>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">PROP-1</span>
            <span className="text-xs font-medium">{copy.proposalName}</span>
            <AnimatePresence mode="wait" initial={false}>
              {step >= 2 && (
                <motion.span
                  key={step >= 3 ? 'm' : 'r'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease }}
                >
                  <ProposalBadge state={step >= 3 ? 'merged' : 'in review'} />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {found.map(f => (
              <li key={f.kind} className="flex items-baseline justify-between gap-2 text-[11px]">
                <ArtifactKindLabel kind={f.kind}>{f.label}</ArtifactKindLabel>
                <span className="font-mono text-foreground/90">
                  <CountUp to={f.count} run={step >= 2} locale={lang === 'es' ? 'es-ES' : 'en-US'} />
                </span>
              </li>
            ))}
          </ul>
          <AnimatePresence>
            {step >= 3 && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-[10px] text-muted-foreground"
              >
                {copy.mergedNote}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
      <StepDots count={copy.steps.length} step={step} onPick={setStep} label={copy.stepLabel} />
    </InfoCard>
  )
}
