import { Fragment, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { FileTextIcon, GitPullRequestIcon, MessageSquareIcon, ShieldCheckIcon, TagIcon } from 'lucide-react'
import { cn } from 'cn'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { CheckLine } from '@newt/ui/domain/check-line'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { Story } from '../../../story'
import { ChatMessage } from '../../mock/chat'
import { useStepper, ease } from '../../motion/stepper'
import { GithubMark } from '../../site/icons'

export type HeroLoopCopy = {
  /** What the animation shows, for screen readers. */
  label: string
  /** One name per stage: talk, propose, gate, pull request, release. */
  stages: string[]
  talk: { caption: string; today: string; says: string; question: string }
  propose: { caption: string }
  gate: { caption: string; conflict: string; explanation: (ruleId: string) => string }
  pr: { caption: (prNumber: number) => string; enforced: string; tested: string; limitSkipped: string; noTest: string }
  release: { caption: string; subtitle: string; shipped: string[] }
}

const icons = [MessageSquareIcon, FileTextIcon, ShieldCheckIcon, GitPullRequestIcon, TagIcon]

/** The whole journey in one loop: talk, propose, gate, PR, release. */
export function HeroLoop({ copy, story }: { copy: HeroLoopCopy; story: Story }) {
  const count = icons.length
  const { ref, step } = useStepper(count, { interval: 2600, hold: 1.4 })
  // Every step stays mounted (so the panel always has the height of the
  // tallest one); a step's content remounts each time it becomes active, so
  // its own entrance animations replay. `round` counts the loops.
  const last = useRef(step)
  const round = useRef(0)
  if (step < last.current) round.current += 1
  last.current = step
  const cards = [
    <TalkCard copy={copy.talk} story={story} />,
    <ProposeCard copy={copy.propose} story={story} />,
    <GateCard copy={copy.gate} story={story} />,
    <PrCard copy={copy.pr} story={story} />,
    <ReleaseCard copy={copy.release} story={story} />,
  ]
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.15, ease }}
      className="relative max-lg:min-w-0"
      aria-label={copy.label}
      role="img"
    >
      <div className="rounded-2xl border bg-card/70 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-5">
        <Timeline labels={copy.stages} step={step} />
        <div className="grid min-h-[290px] overflow-hidden rounded-xl border bg-background/70 p-4">
          {cards.map((card, i) => {
            const active = i === step
            return (
              <div
                key={i}
                aria-hidden={!active}
                inert={!active}
                className={cn('max-lg:min-w-0 transition-opacity duration-300 [grid-area:1/1]', active ? 'opacity-100' : 'invisible opacity-0')}
              >
                <Fragment key={i <= step ? round.current : round.current - 1}>{card}</Fragment>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}

/**
 * The five stages in five equal columns, each circle centred over its label.
 * The line runs between the first and last circle centres, behind them, and
 * fills up to the active one.
 */
function Timeline({ labels, step }: { labels: string[]; step: number }) {
  const count = icons.length
  const span = 100 - 100 / count
  return (
    <ol className="relative mb-5 grid grid-cols-5">
      <div aria-hidden className="absolute top-4 h-px bg-border" style={{ left: `${50 / count}%`, right: `${50 / count}%` }} />
      <motion.div
        aria-hidden
        className="absolute top-4 h-px bg-gradient-to-r from-brand to-brand-2"
        style={{ left: `${50 / count}%` }}
        animate={{ width: `${(step / (count - 1)) * span}%` }}
        transition={{ duration: 0.6, ease }}
      />
      {icons.map((Glyph, i) => (
        <li key={i} className="relative flex min-w-0 flex-col items-center gap-1.5">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-full border bg-card transition-[color,background-color,border-color,box-shadow] duration-300',
              i < step && 'border-brand/60 text-brand',
              i === step && 'border-brand bg-brand text-primary-foreground shadow-[0_0_0_4px] shadow-brand/20',
              i > step && 'text-muted-foreground',
            )}
          >
            <Glyph aria-hidden className="size-4" />
          </span>
          <span className={cn('text-center text-[10px] leading-tight sm:text-[11px]', i === step ? 'text-foreground' : 'text-muted-foreground')}>
            {labels[i]}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mb-3 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">{children}</p>
}

function TalkCard({ copy, story }: { copy: HeroLoopCopy['talk']; story: Story }) {
  const { proposal, rules } = story
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Caption>{copy.caption}</Caption>
      <ChatMessage from={proposal.author}>{proposal.ask}</ChatMessage>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
        <ChatMessage from="claude">
          {copy.today}
          <b>{rules.guestsCannotPay.id}</b>
          {copy.says}“{rules.guestsCannotPay.text}” {copy.question}
        </ChatMessage>
      </motion.div>
    </div>
  )
}

function ProposeCard({ copy, story }: { copy: HeroLoopCopy['propose']; story: Story }) {
  const { proposal, deltas } = story
  return (
    <div>
      <Caption>{copy.caption}</Caption>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{proposal.title}</span>
        <ProposalBadge state="in review" />
      </div>
      <ul className="flex flex-col gap-1.5">
        {deltas.slice(0, 4).map((d, i) => (
          <motion.li
            key={d.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.15 }}
            className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-muted-foreground">{d.id}</span>
              <ArtifactTag kind={d.kind} id={d.artifact} />
              <span className="truncate">{d.after}</span>
            </span>
            <DeltaBadge state={i < 2 ? 'approved' : 'pending'} />
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

function GateCard({ copy, story }: { copy: HeroLoopCopy['gate']; story: Story }) {
  const { rules } = story
  return (
    <div>
      <Caption>{copy.caption}</Caption>
      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-1" aria-hidden>
        {Array.from({ length: 96 }, (_, i) => (
          <motion.span
            key={i}
            className={cn('aspect-square rounded-[3px]', i === 41 ? 'bg-bad' : 'bg-ok/50')}
            initial={{ opacity: 0.15 }}
            animate={{ opacity: [0.15, 1, i === 41 ? 1 : 0.55] }}
            transition={{ delay: (i % 24) * 0.03 + Math.floor(i / 24) * 0.12, duration: 0.5 }}
          />
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2 }}
        className="mt-4 rounded-lg border border-bad/30 bg-bad/8 p-3 text-xs leading-relaxed"
      >
        <span className="font-medium text-bad">
          {copy.conflict} · Δ1 vs {rules.accountOver500.id}.
        </span>{' '}
        {copy.explanation(rules.accountOver500.id)}
      </motion.div>
    </div>
  )
}

function PrCard({ copy, story }: { copy: HeroLoopCopy['pr']; story: Story }) {
  const { pr } = story
  return (
    <div>
      <Caption>{copy.caption(pr.number)}</Caption>
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium">
          <GithubMark className="size-3.5" /> newt / product definition
        </div>
        <div className="flex flex-col gap-1.5">
          <CheckLine result="pass">
            <b>R-12</b> {copy.enforced}
          </CheckLine>
          <CheckLine result="pass">
            <b>R-31</b> {copy.tested}
          </CheckLine>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
            <CheckLine result="fail">
              <b>R-07</b> {copy.limitSkipped} — <span className="font-mono">payment.ts:42</span>
            </CheckLine>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
            <CheckLine result="warn">
              <b>Order</b> {copy.noTest}
            </CheckLine>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

function ReleaseCard({ copy, story }: { copy: HeroLoopCopy['release']; story: Story }) {
  const release = story.releases[1]!
  return (
    <div>
      <Caption>{copy.caption}</Caption>
      <div className="flex items-center justify-between rounded-lg border bg-card p-3">
        <div>
          <div className="text-sm font-semibold">{release.version}</div>
          <div className="text-xs text-muted-foreground">{copy.subtitle}</div>
        </div>
        <ProposalBadge state="merged" />
      </div>
      <ul className="mt-3 space-y-1.5 text-xs">
        {copy.shipped.map((line, i) => (
          <motion.li
            key={line}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.15 }}
            className="flex gap-2"
          >
            <span className="text-ok">+</span> {line}
          </motion.li>
        ))}
      </ul>
    </div>
  )
}
