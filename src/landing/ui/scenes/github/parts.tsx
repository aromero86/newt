import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  GitMergeIcon,
  LoaderCircleIcon,
  LockIcon,
  MinusCircleIcon,
  TagIcon,
  XCircleIcon,
  ZapIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@newt/ui/components/avatar'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { NewtMark } from '@newt/ui/domain/logo'
import type { ProposalState } from '@newt/ui/domain/types'
import { ease } from '../../motion/stepper'
import { GithubMark } from '../../site/icons'
import type { DiffLine } from './data'

// GitHub's own interface (tabs, "opened this pull request", the merge box…)
// stays in English, as it is on github.com. What people and newt write comes in
// through props, already in the visitor's language.

/** Content that appears in a scene: fades and slides in. */
export function Pop({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay, ease }} className={className}>
      {children}
    </motion.div>
  )
}

/** The newt mark, small, for anything newt writes on GitHub. */



/** A comment in a PR conversation, GitHub style. */
export function Comment({ author, meta, children, bot }: { author: string; meta?: string; children: ReactNode; bot?: boolean }) {
  return (
    <div className="flex gap-2.5">
      {bot ? (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border bg-background">
          <NewtMark />
        </span>
      ) : (
        <span className="mt-0.5 flex shrink-0">
          <Avatar name={author} size={7} />
        </span>
      )}
      <div className="min-w-0 flex-1 overflow-hidden rounded-lg border">
        <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-[11px]">
          <span className="font-semibold">{author}</span>
          {bot && <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">bot</span>}
          {meta && <span className="truncate text-muted-foreground">{meta}</span>}
        </div>
        <div className="space-y-2 px-3 py-2.5 text-xs leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

/** "Implements PROP-42": the link between a PR and its proposal in newt. */
export function LinkedProposal({ id, title, state }: { id: string; title: string; state: ProposalState }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/8 px-2.5 py-2">
      <NewtMark />
      <span className="font-mono text-[11px] text-muted-foreground">Implements</span>
      <span className="font-mono text-[11px] font-semibold text-brand">{id}</span>
      <span className="min-w-0 truncate text-[11px]">{title}</span>
      <span className="ml-auto">
        <ProposalBadge state={state} />
      </span>
    </div>
  )
}

export type CheckState = 'queued' | 'running' | 'pass' | 'fail' | 'skipped'

const checkIcon: Record<CheckState, ReactNode> = {
  queued: <CircleDashedIcon className="size-3.5 text-muted-foreground" />,
  running: <LoaderCircleIcon className="size-3.5 animate-spin text-warn motion-reduce:animate-none" />,
  pass: <CheckCircle2Icon className="size-3.5 text-ok" />,
  fail: <XCircleIcon className="size-3.5 text-bad" />,
  skipped: <MinusCircleIcon className="size-3.5 text-muted-foreground" />,
}

/** The checks of a PR, with newt's as a required one. */
export function Checks({ newt, detail, children, others = 'pass' }: { newt: CheckState; detail: ReactNode; children?: ReactNode; others?: CheckState }) {
  const summary =
    newt === 'pass' && others === 'pass'
      ? { text: 'All checks have passed', look: 'text-ok' }
      : newt === 'fail'
        ? { text: 'Some checks were not successful', look: 'text-bad' }
        : newt === 'skipped'
          ? { text: 'A required check did not run', look: 'text-warn' }
          : { text: 'Some checks haven’t completed yet', look: 'text-warn' }
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={cn('border-b bg-muted/40 px-3 py-2 text-xs font-semibold', summary.look)}>{summary.text}</div>
      <div className="divide-y text-xs">
        <div className="flex items-center gap-2 px-3 py-2">
          {checkIcon[others]}
          <span className="font-medium">ci / test</span>
          <span className="truncate text-muted-foreground">{others === 'pass' ? 'Successful in 2m' : 'In progress…'}</span>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-center gap-2">
            {checkIcon[newt]}
            <NewtMark />
            <span className="font-medium">newt / definition</span>
            <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">Required</span>
          </div>
          <div className="mt-1 pl-[22px] text-muted-foreground">{detail}</div>
          {children && <div className="mt-2 space-y-1.5 pl-[22px]">{children}</div>}
        </div>
      </div>
    </div>
  )
}

export type MergeState = 'blocked' | 'ready' | 'merged' | 'urgent'

/** What newt adds to the merge box for the urgent lane, in the visitor's language. */
export type UrgentLabels = { title: string; button: string }

/** The box at the bottom of a PR: can it be merged, and why not. */
export function MergeBox({ state, reason, pressed, urgent: urgentLabels }: { state: MergeState; reason?: ReactNode; pressed?: boolean; urgent?: UrgentLabels }) {
  if (state === 'merged') {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-[#8250df]/40 bg-[#8250df]/10 px-3 py-2.5 text-xs">
        <GitMergeIcon className="mt-0.5 size-4 shrink-0 text-[#a371f7]" />
        <div>
          <div className="font-semibold">Pull request successfully merged and closed</div>
          {reason && <div className="mt-0.5 text-muted-foreground">{reason}</div>}
        </div>
      </div>
    )
  }
  const ready = state === 'ready'
  const urgent = state === 'urgent'
  return (
    <div className={cn('rounded-lg border px-3 py-2.5 text-xs', ready ? 'border-ok/40 bg-ok/8' : urgent ? 'border-warn/40 bg-warn/8' : 'border-bad/40 bg-bad/8')}>
      <div className="flex items-start gap-2">
        {ready ? (
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-ok" />
        ) : urgent ? (
          <ZapIcon className="mt-0.5 size-4 shrink-0 text-warn" />
        ) : (
          <LockIcon className="mt-0.5 size-4 shrink-0 text-bad" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{ready ? 'This branch has no conflicts and every check passed' : urgent ? urgentLabels?.title : 'Merging is blocked'}</div>
          {reason && <div className="mt-0.5 text-muted-foreground">{reason}</div>}
        </div>
      </div>
      <motion.div
        animate={pressed ? { scale: [1, 0.94, 1] } : { scale: 1 }}
        transition={{ duration: 0.35 }}
        className={cn(
          'mt-2.5 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-semibold',
          ready ? 'bg-[#1f883d] text-white' : urgent ? 'bg-warn text-background' : 'cursor-not-allowed bg-muted text-muted-foreground',
        )}
      >
        <GitMergeIcon className="size-3.5" /> {urgent ? urgentLabels?.button : 'Merge pull request'}
      </motion.div>
    </div>
  )
}

/** A file in "Files changed", with newt's annotation under one line. */
export function Diff({ file, lines, annotate, annotation, highlight }: { file: string; lines: DiffLine[]; annotate?: number; annotation?: ReactNode; highlight?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/40 px-3 py-1.5 font-mono text-[11px]">{file}</div>
      <div className="overflow-x-auto">
        <div className="min-w-max font-mono text-[11px] leading-6">
          {lines.map((l, i) => (
            <div key={i}>
              <div className={cn('flex pr-4', l.kind === '+' && (highlight ? 'bg-ok/20' : 'bg-ok/10'), l.kind === '-' && 'bg-bad/10')}>
                <span className="w-9 shrink-0 pr-2 text-right text-muted-foreground/70 select-none">{l.n}</span>
                <span className={cn('w-4 shrink-0 select-none', l.kind === '+' ? 'text-ok' : l.kind === '-' ? 'text-bad' : 'text-muted-foreground')}>
                  {l.kind === ' ' ? '' : l.kind}
                </span>
                <span className="whitespace-pre">{l.code}</span>
              </div>
              {annotate === l.n && l.kind === '+' && annotation}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** newt's annotation on a diff line, like a linter's: the rule it breaks and why. */
export function Annotation({ rule, children }: { rule: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 0.45, ease }} className="overflow-hidden">
      <div className="sticky left-0 my-1 mr-3 ml-9 flex max-w-[min(34rem,calc(100vw-6rem))] gap-2 rounded-md border border-bad/40 bg-card px-2.5 py-2 font-sans text-[11px] leading-relaxed whitespace-normal shadow-lg">
        <XCircleIcon className="mt-0.5 size-3.5 shrink-0 text-bad" />
        <div className="min-w-0">
          <div className="font-semibold">
            newt · <span className="text-bad">rule {rule}</span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{children}</p>
        </div>
      </div>
    </motion.div>
  )
}

/** A little newt panel next to the GitHub mock: what happens on newt's side. */
export function NewtSide({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/15', className)}>
      <div className="flex items-center gap-2 border-b bg-subtle px-3 py-2 text-[11px]">
        <NewtMark />
        <span className="font-semibold">newt</span>
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-2 px-3 py-3 text-xs">{children}</div>
    </div>
  )
}

/** github.com's releases page, imagined: one release card. */
export function GitHubRelease({ version, date, published }: { version: string; date: string; published: boolean }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/15">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-[11px]">
        <GithubMark className="size-3.5" />
        <span className="text-muted-foreground">acme/shop</span>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold">Releases</span>
      </div>
      <div className="flex items-start gap-3 px-3 py-3 text-xs">
        <TagIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{version}</span>
            {published ? (
              <span className="rounded-full border border-ok/40 px-2 text-[10px] font-medium text-ok">Latest</span>
            ) : (
              <span className="rounded-full border px-2 text-[10px] text-muted-foreground">Draft</span>
            )}
          </div>
          <div className="mt-1 text-muted-foreground">
            {published ? `marc published this ${date}` : 'Marc is drafting this release…'} · tag {version} · main
          </div>
        </div>
      </div>
    </div>
  )
}
