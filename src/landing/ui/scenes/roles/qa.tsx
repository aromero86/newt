import { motion } from 'motion/react'
import { CheckIcon, FlaskConicalIcon, ListChecksIcon } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@newt/ui/components/avatar'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { BugBadge } from '@newt/ui/domain/bug-badge'
import { CheckLine } from '@newt/ui/domain/check-line'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'
import { AppWindow, GitHubWindow } from '../../mock/window'
import { Appear, Code, Label, Screen } from './parts'
import type { RolesStory } from './story'

export type QaCopy = {
  criteriaTab: string
  /** given / when / then, as the criteria spell them. */
  keywords: { given: string; when: string; then: string }
  criteria: { given: string; when: string; then: string; test: string | null }[]
  noTest: string
  noTestNote: string
  occurrences: string
  activity: string
  bugTitle: string
  reproduceLabel: string
  reproduce: string[]
  reproduced: string
  breaks: string
  regressionTitle: string
  regression: string
  regressionNote: string
  noTransitions: string
  caught: string
}

export function QaScene({ step, copy, story }: { step: number; copy: QaCopy; story: RolesStory }) {
  const screen = step <= 1 ? 'criteria' : step <= 3 ? 'bug' : 'regression'
  return (
    <Screen id={screen}>
      {screen === 'criteria' && <Criteria step={step} copy={copy} story={story} />}
      {screen === 'bug' && <Reproduce step={step} copy={copy} story={story} />}
      {screen === 'regression' && <Regression copy={copy} story={story} />}
    </Screen>
  )
}

function Criteria({ step, copy, story }: { step: number; copy: QaCopy; story: RolesStory }) {
  const mapped = step >= 1
  const { keywords } = copy
  return (
    <AppWindow
      crumbs={['acme-shop', 'proposals', 'PROP-42', 'Δ1']}
      tabs={[{ label: 'Delta' }, { label: copy.criteriaTab, count: 3 }, { label: 'Tests' }]}
      active={copy.criteriaTab}
    >
      <div className="space-y-2.5 p-4 text-xs">
        <p className="flex flex-wrap items-center gap-1.5">
          <ArtifactTag kind="rule" id="R-12" /> {story.rules.guestsPayBizum.text}
        </p>
        {copy.criteria.map((c, i) => (
          <motion.div
            key={c.when}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 * i }}
            className={cn('rounded-lg border p-3', mapped && !c.test && 'border-warn/50 bg-warn/8')}
          >
            <p className="leading-relaxed">
              <span className="font-mono text-brand">{keywords.given}</span> {c.given} <span className="font-mono text-brand">{keywords.when}</span> {c.when}{' '}
              <span className="font-mono text-brand">{keywords.then}</span> {c.then}.
            </p>
            <Appear when={mapped} delay={0.2 * i}>
              <div className="mt-2 border-t pt-2">
                {c.test ? (
                  <CheckLine result="pass">
                    <span className="font-mono text-muted-foreground">{c.test}</span>
                  </CheckLine>
                ) : (
                  <CheckLine result="warn">
                    <span className="text-warn">{copy.noTest}</span> <span className="text-muted-foreground">{copy.noTestNote}</span>
                  </CheckLine>
                )}
              </div>
            </Appear>
          </motion.div>
        ))}
      </div>
    </AppWindow>
  )
}

function Reproduce({ step, copy, story }: { step: number; copy: QaCopy; story: RolesStory }) {
  const { rule, dimension, people } = story
  const confirmed = step >= 3
  const chips = [dimension('surface', 'Mobile app'), dimension('role', 'Guest'), dimension('market', 'Spain')]
  return (
    <AppWindow
      crumbs={['acme-shop', 'bugs', 'BUG-81']}
      tabs={[{ label: 'Bug' }, { label: copy.occurrences, count: 4 }, { label: copy.activity }]}
      active="Bug"
    >
      <div className="space-y-3 p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{copy.bugTitle}</h3>
          <motion.span key={confirmed ? 'c' : 'r'} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <BugBadge state={confirmed ? 'confirmed' : 'reported'} />
          </motion.span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chips.map(c => (
            <DimensionChip key={c.name} name={c.name} value={c.value} />
          ))}
        </div>
        <div className="rounded-lg border p-3">
          <Label>{copy.reproduceLabel}</Label>
          <ul className="space-y-1.5">
            {copy.reproduce.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className="relative flex size-4 items-center justify-center rounded border">
                  {step >= 2 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.5 + 0.45 * i }}
                      className="absolute inset-0 flex items-center justify-center rounded bg-ok"
                    >
                      <CheckIcon className="size-3 text-background" />
                    </motion.span>
                  )}
                </span>
                {s}
              </li>
            ))}
          </ul>
          <Appear when={step >= 2} delay={1.9}>
            <p className="mt-2 flex items-center gap-2 text-muted-foreground">
              <Avatar name={people.qa} size={5} /> {copy.reproduced}
            </p>
          </Appear>
        </div>
        <Appear when={confirmed}>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/40 bg-bad/10 p-3">
            <ListChecksIcon className="size-4 text-bad" />
            <span>{copy.breaks}</span> <ArtifactTag kind="rule" id="R-31" />
            <span className="text-muted-foreground">{rule('R-31')}</span>
          </div>
        </Appear>
      </div>
    </AppWindow>
  )
}

function Regression({ copy, story }: { copy: QaCopy; story: RolesStory }) {
  const { rule } = story
  return (
    <GitHubWindow number={321} title={copy.regressionTitle} state="blocked" active="Files changed">
      <div className="space-y-3 p-4 text-xs">
        <p className="font-mono text-[11px] text-muted-foreground">src/cart/totals.ts</p>
        <Code
          lines={[
            { n: 18, text: 'export function applyCoupon(order, coupon) {' },
            { n: 19, text: '  order.amount = recompute(order, coupon)', mark: 'hit' },
            { n: 20, text: '}' },
          ]}
        />
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 border-b px-3 py-2 font-medium">
            <FlaskConicalIcon className="size-3.5 text-bad" /> newt / product check
            <span className="ml-auto font-normal text-muted-foreground">{copy.regression}</span>
          </div>
          <div className="space-y-1.5 p-3">
            <CheckLine result="fail">
              <ArtifactTag kind="rule" id="R-02" /> {rule('R-02')} <span className="text-muted-foreground">{copy.regressionNote}</span>
            </CheckLine>
            <CheckLine result="pass">
              <ArtifactTag kind="lifecycle" id="Order" /> {copy.noTransitions}
            </CheckLine>
          </div>
        </div>
        <p className="text-muted-foreground">{copy.caught}</p>
      </div>
    </GitHubWindow>
  )
}
