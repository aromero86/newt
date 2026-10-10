import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { MailIcon } from 'lucide-react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { ChatMessage, ChatPanel, ToolCall } from '../../mock/chat'
import { AppWindow } from '../../mock/window'
import { Typing } from '../../motion/typing'
import { Appear, Label, Panel, Screen } from './parts'
import type { RolesStory } from './story'

export type SalesCopy = {
  chat: string
  subject: string
  plan: string
  email: ReactNode
  question: string
  definition: string
  current: string
  planned: string
  currentLabel: string
  plannedLabel: string
  notHere: string
  /** Where the planned change applies, from a dimension's name and value. */
  only: (name: string, value: string) => string
  filtered: string
  today: ReactNode
  next: ReactNode
  offer: string
  yes: string
  requestTitle: string
  requestedBy: string
  waiting: string
}

export function SalesScene({ step, copy, story }: { step: number; copy: SalesCopy; story: RolesStory }) {
  const screen = step <= 1 ? 'ask' : step === 2 ? 'definition' : 'answer'
  return (
    <Screen id={screen}>
      {screen === 'ask' && <Ask step={step} copy={copy} story={story} />}
      {screen === 'definition' && <Definition copy={copy} story={story} />}
      {screen === 'answer' && <Answer step={step} copy={copy} story={story} />}
    </Screen>
  )
}

function Ask({ step, copy, story }: { step: number; copy: SalesCopy; story: RolesStory }) {
  const { dimension, people } = story
  const filter = [dimension('market', 'Mexico'), dimension('plan', 'Premium'), dimension('role', 'Guest')].map(d => `${d.name}: ${d.value}`).join(' · ')
  return (
    <div className="flex flex-col gap-4">
      <Panel title={copy.subject} icon={<MailIcon className="size-3.5 text-muted-foreground" />} aside={<span className="text-muted-foreground">{copy.plan}</span>}>
        <p className="text-sm leading-relaxed text-muted-foreground">{copy.email}</p>
      </Panel>
      <Appear when={step >= 1}>
        <ChatPanel title={copy.chat}>
          <ChatMessage from={people.sales}>
            <Typing text={copy.question} active={step >= 1} />
          </ChatMessage>
          <ToolCall name="definition">{filter}</ToolCall>
        </ChatPanel>
      </Appear>
    </div>
  )
}

function Definition({ copy, story }: { copy: SalesCopy; story: RolesStory }) {
  const { rule, dimension, proposal } = story
  const current = [
    { id: 'R-12', text: rule('R-12') },
    { id: 'R-07', text: rule('R-07') },
  ]
  const spain = dimension('market', 'Spain')
  const chips = [
    { ...dimension('market', 'Mexico'), active: true },
    { ...dimension('plan', 'Premium'), active: true },
    { ...dimension('role', 'Guest'), active: true },
    { ...dimension('surface', 'any'), active: false },
  ]
  return (
    <AppWindow crumbs={['acme-shop', copy.definition]} tabs={[{ label: copy.current }, { label: copy.planned }, { label: 'Changelog' }]} active={copy.planned}>
      <div className="space-y-3 p-4 text-xs">
        <div className="flex flex-wrap gap-1.5">
          {chips.map(c => (
            <DimensionChip key={c.name} name={c.name} value={c.value} active={c.active} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <Label>{copy.currentLabel}</Label>
            <ul className="space-y-2">
              {current.map((r, i) => (
                <motion.li key={r.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i }}>
                  <ArtifactTag kind="rule" id={r.id} /> <span className="ml-1">{r.text}</span>
                </motion.li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-dashed p-3">
            <Label>{copy.plannedLabel}</Label>
            <ul className="space-y-2">
              <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="opacity-60">
                <span className="font-mono text-muted-foreground">{proposal.id}</span> <ProposalBadge state="accepted" />
                <p className="mt-1">{proposal.title}</p>
                <p className="mt-0.5 text-warn">
                  {copy.notHere}: {copy.only(spain.name, spain.value)}
                </p>
              </motion.li>
            </ul>
          </div>
        </div>
        <p className="text-muted-foreground">{copy.filtered}</p>
      </div>
    </AppWindow>
  )
}

function Answer({ step, copy, story }: { step: number; copy: SalesCopy; story: RolesStory }) {
  const { people } = story
  return (
    <div className="flex flex-col gap-4">
      <ChatPanel title={copy.chat}>
        <ChatMessage from="claude">
          <p>{copy.today}</p>
          <p className="mt-1.5">{copy.next}</p>
          <p className="mt-1.5 text-muted-foreground">{copy.offer}</p>
        </ChatMessage>
        {step >= 4 && (
          <>
            <ChatMessage from={people.sales}>{copy.yes}</ChatMessage>
            <ToolCall name="create_proposal">"{copy.requestTitle}" → PROP-47</ToolCall>
          </>
        )}
      </ChatPanel>
      <Appear when={step >= 4}>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-xs shadow-xl shadow-black/10">
          <span className="font-mono text-muted-foreground">PROP-47</span>
          <span className="font-medium">{copy.requestTitle}</span>
          <ProposalBadge state="draft" />
          <span className="text-muted-foreground">
            · {copy.requestedBy} {people.sales} · {copy.waiting}
          </span>
        </div>
      </Appear>
    </div>
  )
}
