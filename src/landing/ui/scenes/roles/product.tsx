import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { CheckCircle2Icon, FileTextIcon, ShieldAlertIcon } from 'lucide-react'
import { cn } from 'cn'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { ChatMessage, ChatPanel, ToolCall } from '../../mock/chat'
import { AppWindow } from '../../mock/window'
import { Typing } from '../../motion/typing'
import { Appear, Label, Screen } from './parts'
import type { RolesStory } from './story'

export type ProductCopy = {
  chat: string
  search: string
  /** Claude's opening, quoting what R-12 says today. */
  today: (rule: string) => ReactNode
  questions: string[]
  document: string
  by: string
  deltas: string
  conflict: string
  accepted: string
  acceptedNote: string
}

export function ProductScene({ step, copy, story }: { step: number; copy: ProductCopy; story: RolesStory }) {
  const inApp = step >= 2
  return (
    <Screen id={inApp ? 'app' : 'chat'}>
      {inApp ? <ProposalPage step={step} copy={copy} story={story} /> : <Conversation step={step} copy={copy} story={story} />}
    </Screen>
  )
}

function Conversation({ step, copy, story }: { step: number; copy: ProductCopy; story: RolesStory }) {
  const { proposal, rule, people } = story
  return (
    <ChatPanel title={copy.chat} className="min-h-[440px]">
      <ChatMessage from={people.product}>
        <Typing text={proposal.ask} active />
      </ChatMessage>
      {step >= 1 && (
        <>
          <ToolCall name="search">{copy.search} → rule R-12, rule R-07</ToolCall>
          <ChatMessage from="claude">
            <p>{copy.today(rule('R-12'))}</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
              {copy.questions.map(q => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </ChatMessage>
        </>
      )}
    </ChatPanel>
  )
}

function ProposalPage({ step, copy, story }: { step: number; copy: ProductCopy; story: RolesStory }) {
  const { proposal, deltas, conflict, rules } = story
  const showDeltas = step >= 3
  const conflicted = step === 4
  const done = step >= 5
  const state = done ? 'accepted' : 'in review'

  return (
    <AppWindow
      crumbs={['acme-shop', 'proposals', proposal.id]}
      tabs={[{ label: copy.document }, { label: 'Deltas', count: 5 }, { label: 'Revisions', count: done ? 2 : 1 }]}
      active="Deltas"
    >
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{proposal.title}</h3>
          <ProposalBadge state={state} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {proposal.feature} · {copy.by} {proposal.author} · revision {done ? 2 : 1}
        </p>

        {!showDeltas && (
          <div className="mt-4 space-y-2 rounded-lg border bg-subtle p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <FileTextIcon className="size-3.5" /> {copy.document}
            </p>
            {proposal.document.map((line, i) => (
              <motion.p key={line} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 * i }}>
                {line}
              </motion.p>
            ))}
          </div>
        )}

        {showDeltas && (
          <div className="mt-4">
            <Label>{copy.deltas}</Label>
            <ul className="divide-y rounded-lg border">
              {deltas.map((d, i) => {
                const isConflict = d.id === conflict.delta
                const text = done && isConflict ? rules.guestsPayBizum.text : d.after
                return (
                  <motion.li
                    key={d.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: step === 3 ? 0.12 * i : 0 }}
                    className={cn('flex items-start gap-2.5 px-3 py-2 text-xs', conflicted && isConflict && 'bg-bad/8')}
                  >
                    <span className="mt-0.5 font-mono text-muted-foreground">{d.id}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ArtifactTag kind={d.kind} id={d.artifact} />
                        <span className="text-muted-foreground">{d.opLabel}</span>
                      </div>
                      <p className="mt-1 leading-snug">{text}</p>
                    </div>
                    <span className="shrink-0">
                      <DeltaBadge state={done || (conflicted && !isConflict) ? 'approved' : 'pending'} />
                    </span>
                  </motion.li>
                )
              })}
            </ul>
          </div>
        )}

        <Appear when={conflicted} className="mt-3">
          <div className="flex gap-2 rounded-lg border border-bad/40 bg-bad/10 p-3 text-xs">
            <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-bad" />
            <div>
              <p className="font-medium text-bad">
                {copy.conflict}: {conflict.delta} ↔ {conflict.with.id}
              </p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{conflict.explanation}</p>
            </div>
          </div>
        </Appear>

        <Appear when={done} className="mt-3">
          <div className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 p-3 text-xs">
            <CheckCircle2Icon className="size-4 shrink-0 text-ok" />
            <p>
              <span className="font-medium text-ok">{copy.accepted}</span> <span className="text-muted-foreground">{copy.acceptedNote}</span>
            </p>
          </div>
        </Appear>
      </div>
    </AppWindow>
  )
}
