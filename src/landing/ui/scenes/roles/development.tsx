import { motion } from 'motion/react'
import { CircleDotIcon, GitMergeIcon, LoaderCircleIcon, MessageSquareWarningIcon } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@newt/ui/components/avatar'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { BugBadge } from '@newt/ui/domain/bug-badge'
import { CheckLine } from '@newt/ui/domain/check-line'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { AppWindow, GitHubWindow } from '../../mock/window'
import { FakeCursor } from '../../motion/typing'
import { Appear, Code, Label, Screen } from './parts'
import type { RolesStory } from './story'

export type DevelopmentCopy = {
  /** The other accepted proposal on the board. */
  otherProposal: string
  toDo: string
  inProgress: string
  done: string
  ready: string
  line: string
  /** What newt says about the line that breaks R-07. */
  breaks: string
  queued: string
  reading: string
  passing: string
  failing: string
  checks: { r12: string; r07: string; parameter: string; lifecycle: string }
  document: string
  delivery: string
  mergedBy: string
  updated: string
  promoted: string
  byMerge: string
}

export function DevelopmentScene({ step, copy, story }: { step: number; copy: DevelopmentCopy; story: RolesStory }) {
  const screen = step === 0 ? 'board' : step <= 4 ? 'pr' : 'newt'
  return (
    <Screen id={screen}>
      {screen === 'board' && <Backlog copy={copy} story={story} />}
      {screen === 'pr' && <PullRequest step={step} copy={copy} story={story} />}
      {screen === 'newt' && <Merged copy={copy} story={story} />}
    </Screen>
  )
}

function Backlog({ copy, story }: { copy: DevelopmentCopy; story: RolesStory }) {
  const { proposal, bug, people } = story
  const items = [
    { id: proposal.id, title: proposal.title, kind: 'proposal' as const },
    { id: 'PROP-39', title: copy.otherProposal, kind: 'proposal' as const },
    { id: bug.id, title: bug.title, kind: 'bug' as const },
  ]
  return (
    <AppWindow crumbs={['acme-shop', 'board']} tabs={[{ label: copy.toDo, count: 3 }, { label: copy.inProgress, count: 2 }, { label: copy.done }]} active={copy.toDo}>
      <div className="relative space-y-2 p-4">
        <Label>{copy.ready}</Label>
        {items.map((it, i) => (
          <motion.div
            key={it.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * i }}
            className={cn('flex items-center gap-3 rounded-lg border bg-card p-3 text-xs', i === 0 && 'ring-1 ring-brand/50')}
          >
            <span className="font-mono text-muted-foreground">{it.id}</span>
            <span className="min-w-0 flex-1 truncate">{it.title}</span>
            {it.kind === 'proposal' ? <ProposalBadge state="accepted" /> : <BugBadge state="confirmed" />}
            {i === 0 ? (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.4 }}>
                <Avatar name={people.dev} />
              </motion.span>
            ) : (
              <span className="size-6 rounded-full border border-dashed" aria-hidden />
            )}
          </motion.div>
        ))}
        <FakeCursor x={88} y={44} click />
      </div>
    </AppWindow>
  )
}

function PullRequest({ step, copy, story }: { step: number; copy: DevelopmentCopy; story: RolesStory }) {
  const { proposal, pr, rule } = story
  const checking = step === 2
  const failed = step === 3
  const passed = step >= 4
  const files = step >= 3

  // GitHub's own interface stays in English; what newt and people write is translated.
  return (
    <GitHubWindow number={pr.number} title={pr.title} state={passed ? 'open' : 'blocked'} active={files ? 'Files changed' : 'Conversation'}>
      <div className="space-y-3 p-4">
        {!files && (
          <div className="rounded-lg border p-3 text-xs">
            <p className="flex items-center gap-2 text-muted-foreground">
              <Avatar name={pr.author} /> <span className="font-medium text-foreground">{pr.author}</span> opened this pull request
            </p>
            <p className="mt-2 font-mono">
              Implements <span className="text-brand">newt:{proposal.id}</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
              ↳ {proposal.title} <ProposalBadge state="accepted" />
            </p>
          </div>
        )}

        {files && (
          <div className="space-y-2">
            <p className="font-mono text-[11px] text-muted-foreground">{pr.file}</p>
            <Code
              lines={
                passed
                  ? [
                      { n: 41, text: "if (user.role === 'guest') {" },
                      { n: 42, text: "  if (method !== 'bizum') return reject('sign-up')", mark: 'add' },
                      { n: 43, text: "  if (amount > limits.guestBizum) return reject('sign-up')", mark: 'add' },
                      { n: 44, text: '}' },
                    ]
                  : [
                      { n: 41, text: "if (user.role === 'guest') {" },
                      { n: 42, text: "  if (method !== 'bizum') return reject('sign-up')" },
                      { n: 43, text: '  return allow()', mark: 'hit' },
                      { n: 44, text: '}' },
                    ]
              }
            />
            <Appear when={failed}>
              <div className="flex gap-2 rounded-lg border border-bad/40 bg-bad/10 p-2.5 text-xs">
                <MessageSquareWarningIcon className="mt-0.5 size-3.5 shrink-0 text-bad" />
                <p>
                  <span className="font-medium">newt</span> · {copy.line} 43 · <ArtifactTag kind="rule" id="R-07" />{' '}
                  <span className="text-muted-foreground">
                    {rule('R-07')} {copy.breaks}
                  </span>
                </p>
              </div>
            </Appear>
          </div>
        )}

        <div className="rounded-lg border">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
            {checking ? (
              <LoaderCircleIcon className="size-3.5 animate-spin text-warn" />
            ) : (
              <CircleDotIcon className={cn('size-3.5', passed ? 'text-ok' : step >= 3 ? 'text-bad' : 'text-muted-foreground')} />
            )}
            newt / product check
            <span className="ml-auto font-normal text-muted-foreground">{step < 2 ? copy.queued : checking ? copy.reading : passed ? copy.passing : copy.failing}</span>
          </div>
          {step >= 3 && (
            <div className="space-y-1.5 p-3">
              <CheckLine result="pass">
                <ArtifactTag kind="rule" id="R-12" /> {copy.checks.r12}
              </CheckLine>
              <CheckLine result={passed ? 'pass' : 'fail'}>
                <ArtifactTag kind="rule" id="R-07" /> {copy.checks.r07}
              </CheckLine>
              <CheckLine result="pass">
                <ArtifactTag kind="parameter" id="bizum.guest_limit" /> {copy.checks.parameter}
              </CheckLine>
              <CheckLine result="pass">
                <ArtifactTag kind="lifecycle" id="Order" /> {copy.checks.lifecycle}
              </CheckLine>
            </div>
          )}
        </div>

        <Appear when={passed}>
          <motion.div
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
            className="flex items-center justify-between rounded-lg bg-[#1f883d] px-3 py-2 text-xs font-medium text-white"
          >
            <span className="flex items-center gap-1.5">
              <GitMergeIcon className="size-3.5" /> All checks passed
            </span>
            <span className="rounded-md bg-white/15 px-2 py-0.5">Merge pull request</span>
          </motion.div>
        </Appear>
      </div>
    </GitHubWindow>
  )
}

function Merged({ copy, story }: { copy: DevelopmentCopy; story: RolesStory }) {
  const { proposal, pr } = story
  return (
    <AppWindow
      crumbs={['acme-shop', 'proposals', proposal.id]}
      tabs={[{ label: copy.document }, { label: 'Deltas', count: 5 }, { label: copy.delivery, count: 1 }]}
      active={copy.delivery}
    >
      <div className="space-y-3 p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{proposal.title}</h3>
          <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }}>
            <ProposalBadge state="merged" />
          </motion.span>
        </div>
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <GitMergeIcon className="size-4 text-[#a371f7]" />
          <span>
            <span className="font-mono">acme/shop#{pr.number}</span> {copy.mergedBy} {pr.author}
          </span>
        </div>
        <div className="rounded-lg border bg-subtle p-3">
          <Label>{copy.updated}</Label>
          <ul className="space-y-1.5">
            {['R-12', 'R-31', 'Order', 'bizum.guest_limit', 'Guest'].map((id, i) => (
              <motion.li
                key={id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + 0.12 * i }}
                className="flex items-center gap-2"
              >
                <span className="text-ok">●</span> <span className="font-mono">{id}</span>
                <span className="text-muted-foreground">{copy.promoted}</span>
              </motion.li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground">{copy.byMerge}</p>
      </div>
    </AppWindow>
  )
}
