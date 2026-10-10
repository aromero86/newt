import { AnimatePresence, motion } from 'motion/react'
import { cn } from 'cn'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import type { ArtifactKind } from '@newt/ui/domain/types'
import type { Story } from '../../../story'
import { AppWindow } from '../../mock/window'
import { useStepper } from '../../motion/stepper'

export type DefinitionCopy = {
  definition: string
  current: string
  planned: string
  notYet: string
  /** The free-shipping threshold today and once the planned proposals ship. */
  freeShipping: { current: string; planned: string }
  currentNote: string
  plannedNote: string
}

type Item = { kind: ArtifactKind; id: string; current: string | null; planned: string }

/** What the definition shows, now and once PROP-42 is merged: the story's own words. */
function itemsOf(story: Pick<Story, 'rules' | 'deltas'>, copy: DefinitionCopy): Item[] {
  const { rules, deltas } = story
  const lifecycle = deltas.find(d => d.id === 'Δ3')!
  return [
    { kind: 'rule', id: 'R-12', current: rules.guestsCannotPay.text, planned: rules.guestsPayBizum.text },
    { kind: 'rule', id: 'R-31', current: null, planned: rules.invoiceByEmail.text },
    { kind: 'lifecycle', id: 'Order', current: lifecycle.before!, planned: lifecycle.after },
    { kind: 'rule', id: 'R-04', current: rules.freeShipping.text, planned: rules.freeShipping.text },
    { kind: 'parameter', id: 'free_shipping', current: copy.freeShipping.current, planned: copy.freeShipping.planned },
  ]
}

/** Flips between the current definition and the planned one, highlighting what changes. */
export function DefinitionScreen({ copy, story }: { copy: DefinitionCopy; story: Pick<Story, 'rules' | 'deltas'> }) {
  const items = itemsOf(story, copy)
  const { ref, step } = useStepper(2, { interval: 2800, hold: 1 })
  const planned = step === 1
  return (
    <div ref={ref}>
      <AppWindow crumbs={['acme-shop', copy.definition]} bodyClassName="p-3">
        <div className="mb-3 flex items-center gap-1 rounded-lg bg-muted p-1 text-[11px]">
          {[copy.current, copy.planned].map((label, i) => (
            <span key={i} className="relative flex-1 rounded-md py-1 text-center">
              {(i === 1) === planned && <motion.span layoutId="def-tab" className="absolute inset-0 rounded-md bg-background shadow-sm" />}
              <span className="relative">{label}</span>
            </span>
          ))}
        </div>
        <ul className="flex flex-col gap-1.5 text-[11px]">
          {items.map(it => {
            const text = planned ? it.planned : it.current
            const changed = it.current !== it.planned
            return (
              <li key={it.id} className={cn('flex min-h-9 items-start gap-2 rounded-md border bg-card p-2 transition-colors', planned && changed && 'border-brand/50 bg-brand/5')}>
                <ArtifactTag kind={it.kind} id={it.id} />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={String(planned)}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={cn('leading-snug', !text && 'text-muted-foreground italic')}
                  >
                    {text ?? copy.notYet}
                  </motion.span>
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground">{planned ? copy.plannedNote : copy.currentNote}</p>
      </AppWindow>
    </div>
  )
}
