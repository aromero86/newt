import type { ReactNode } from 'react'
import { InboxIcon, LifeBuoyIcon } from 'lucide-react'
import { Avatar } from '@newt/ui/components/avatar'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { BugBadge } from '@newt/ui/domain/bug-badge'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'
import { ChatMessage, ChatPanel, ToolCall } from '../../mock/chat'
import { Typing } from '../../motion/typing'
import { Appear, Counter, Panel } from './parts'
import type { RolesStory } from './story'

export type SupportCopy = {
  chat: string
  question: string
  inbox: string
  country: string
  complaint: string
  violates: string
  occurrences: string
  search: string
  /** Claude's answer, before the workaround. */
  known: (bug: string) => ReactNode
  /** Claude's last message, with the new occurrence's number. */
  added: (occurrence: number) => string
}

export function SupportScene({ step, copy, story }: { step: number; copy: SupportCopy; story: RolesStory }) {
  const { bug, people } = story
  return (
    <div className="grid h-full gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="flex flex-col gap-4">
        <Panel title={copy.inbox} icon={<InboxIcon className="size-3.5 text-muted-foreground" />} aside={<span className="text-muted-foreground">#4812</span>}>
          <div className="flex gap-2.5 text-sm">
            <Avatar name="Carmen" />
            <div>
              <p className="font-medium">
                Carmen R. <span className="font-normal text-muted-foreground">· iPhone · {copy.country}</span>
              </p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{copy.complaint}</p>
            </div>
          </div>
        </Panel>

        <Appear when={step >= 2}>
          <Panel title={bug.id} icon={<LifeBuoyIcon className="size-3.5 text-bad" />} aside={<BugBadge state="confirmed" />}>
            <p className="text-sm font-medium">{bug.title}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {bug.scope.map(s => {
                const [name, value] = s.split(': ')
                return <DimensionChip key={s} name={name} value={value} />
              })}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                {copy.violates} <ArtifactTag kind={bug.violates.kind} id={bug.violates.id} />
              </span>
              <span className="flex items-baseline gap-1">
                <Counter value={step >= 4 ? bug.occurrences + 1 : bug.occurrences} className="text-base font-semibold text-foreground" />
                {copy.occurrences}
              </span>
            </div>
          </Panel>
        </Appear>
      </div>

      <ChatPanel title={copy.chat} className="min-h-[300px]">
        {step >= 1 && (
          <ChatMessage from={people.support}>
            <Typing text={copy.question} active={step >= 1} />
          </ChatMessage>
        )}
        {step >= 2 && (
          <ToolCall name="search_bugs">
            {copy.search} → {bug.id}
          </ToolCall>
        )}
        {step >= 3 && (
          <ChatMessage from="claude">
            <p>{copy.known(bug.id)}</p>
            <p className="mt-1.5 text-muted-foreground">{bug.workaround}</p>
          </ChatMessage>
        )}
        {step >= 4 && (
          <>
            <ToolCall name="add_occurrence">{bug.id} ← ticket #4812</ToolCall>
            <ChatMessage from="claude">{copy.added(bug.occurrences + 1)}</ChatMessage>
          </>
        )}
      </ChatPanel>
    </div>
  )
}
