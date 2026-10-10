import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2Icon, XCircleIcon, GitCommitHorizontalIcon } from 'lucide-react'
import { cn } from 'cn'
import { Checkbox } from '@newt/ui/components/checkbox'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import type { Story } from '../../../story'
import { AppWindow } from '../../mock/window'
import { FakeCursor } from '../../motion/typing'
import { useStepper } from '../../motion/stepper'
import { Button } from '@newt/ui/components/button'

export type ProposalCopy = {
  document: string
  checks: string
  state: string
  conflict: string
  noConflicts: string
  revision1: string
  revision2: string
  accept: string
  viewed: (delta: string) => string
}

const cursor = [
  { x: 92, y: 30 },
  { x: 6, y: 47 },
  { x: 6, y: 60 },
  { x: 92, y: 52 },
  { x: 6, y: 34 },
  { x: 85, y: 88 },
]

/*
 * 0 Δ2–Δ5 pending, conflict on Δ1
 * 1 Δ2 viewed  2 Δ3 viewed
 * 3 revision 2 fixes Δ1: conflict gone
 * 4 Δ1 approved  5 accepted
 */
export function ProposalScreen({ copy, story }: { copy: ProposalCopy; story: Pick<Story, 'deltas' | 'proposal' | 'conflict' | 'rules'> }) {
  const { deltas, proposal, conflict, rules } = story
  const { ref, step } = useStepper(6, { interval: 1700, hold: 2 })
  const approved = (i: number) => (i === 0 ? step >= 4 : i === 1 ? step >= 1 : i === 2 ? step >= 2 : true)
  const at = cursor[step]!
  return (
    <div ref={ref}>
      <AppWindow
        crumbs={['acme-shop', 'Proposals', proposal.id]}
        tabs={[
          { label: 'Deltas', count: 5 },
          { label: copy.document },
          { label: copy.checks, count: step >= 3 ? 0 : 1 },
          { label: 'Revisions', count: step >= 3 ? 2 : 1 },
        ]}
        active="Deltas"
        bodyClassName="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_150px]"
      >
        <FakeCursor x={at.x} y={at.y} click />
        <ul className="flex min-w-0 flex-col gap-1.5">
          {deltas.map((d, i) => (
            <li key={d.id} className={cn('flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-[11px]', i === 0 && step < 3 && 'border-bad/50 bg-bad/5')}>
              <Checkbox checked={approved(i)} label={copy.viewed(d.id)} readOnly />
              <span className="font-mono text-muted-foreground">{d.id}</span>
              <span className="flex shrink-0 max-sm:hidden">
                <ArtifactTag kind={d.kind} id={d.artifact} />
              </span>
              <span className="min-w-0 flex-1 truncate">{i === 0 && step >= 3 ? rules.guestsPayBizum.text : d.after}</span>
              <DeltaBadge state={approved(i) ? 'approved' : 'pending'} />
            </li>
          ))}
        </ul>
        <aside className="flex min-w-0 flex-col gap-2 text-[11px]">
          <div className="rounded-md border bg-card p-2">
            <div className="mb-1 text-muted-foreground">{copy.state}</div>
            <AnimatePresence mode="wait">
              <motion.div key={step >= 5 ? 'a' : 'r'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <ProposalBadge state={step >= 5 ? 'accepted' : 'in review'} />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className={cn('rounded-md border p-2', step < 3 ? 'border-bad/40 bg-bad/5' : 'border-ok/40 bg-ok/5')}>
            {step < 3 ? (
              <>
                <div className="flex items-center gap-1 font-medium text-bad">
                  <XCircleIcon aria-hidden className="size-3" /> {conflict.delta} vs {conflict.with.id}
                </div>
                <p className="mt-1 leading-snug text-muted-foreground">{copy.conflict}</p>
              </>
            ) : (
              <div className="flex items-center gap-1 font-medium text-ok">
                <CheckCircle2Icon aria-hidden className="size-3" /> {copy.noConflicts}
              </div>
            )}
          </div>
          <div className="rounded-md border bg-card p-2">
            <div className="mb-1 text-muted-foreground">Revisions</div>
            <Rev n={1} text={copy.revision1} />
            <AnimatePresence>{step >= 3 && <Rev n={2} text={copy.revision2} fresh />}</AnimatePresence>
          </div>
          <Button size="sm" disabled={step < 4}>
            {copy.accept}
          </Button>
        </aside>
      </AppWindow>
    </div>
  )
}

function Rev({ n, text, fresh }: { n: number; text: string; fresh?: boolean }) {
  return (
    <motion.div initial={fresh ? { opacity: 0, height: 0 } : false} animate={{ opacity: 1, height: 'auto' }} className="flex items-center gap-1.5 py-0.5">
      <GitCommitHorizontalIcon aria-hidden className="size-3 text-brand" />
      <span className="font-mono">r{n}</span>
      <span className="truncate text-muted-foreground">{text}</span>
    </motion.div>
  )
}
