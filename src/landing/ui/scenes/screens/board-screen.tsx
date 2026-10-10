import { motion, AnimatePresence } from 'motion/react'
import { BugIcon, FileTextIcon, FilterIcon } from 'lucide-react'
import { cn } from 'cn'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'
import { AppWindow } from '../../mock/window'
import { FakeCursor } from '../../motion/typing'
import { useStepper } from '../../motion/stepper'
import { Avatar } from '@newt/ui/components/avatar'

export type BoardCopy = {
  surface: string
  mobileApp: string
  market: string
  any: string
  type: string
  proposalsAndBugs: string
  items: (count: number) => string
  columns: [string, string, string, string]
  /** Item titles by id. */
  titles: Record<string, string>
}

type Surface = 'web' | 'mobile' | 'backoffice'
type Item = { id: string; col: number; bug?: boolean; surface: Surface; who?: string }

const items: Item[] = [
  { id: 'PROP-51', col: 0, surface: 'web' },
  { id: 'BUG-80', col: 0, bug: true, surface: 'mobile' },
  { id: 'PROP-42', col: 1, surface: 'mobile', who: 'Marc' },
  { id: 'PROP-45', col: 1, surface: 'web', who: 'Ana' },
  { id: 'BUG-77', col: 1, bug: true, surface: 'mobile', who: 'Marc' },
  { id: 'PROP-39', col: 2, surface: 'backoffice', who: 'Ana' },
  { id: 'PROP-40', col: 2, surface: 'mobile', who: 'Marc' },
  { id: 'PROP-36', col: 3, surface: 'web' },
]

/** The board, filtering itself down to the mobile app and back. */
export function BoardScreen({ copy }: { copy: BoardCopy }) {
  const { ref, step } = useStepper(3, { interval: 2200, hold: 1.4 })
  const filtered = step >= 1
  const visible = items.filter(i => !filtered || i.surface === 'mobile')
  return (
    <div ref={ref}>
      <AppWindow crumbs={['acme-shop', 'Board']} bodyClassName="p-3">
        <FakeCursor x={filtered ? 13 : 32} y={filtered ? 30 : 60} click={step === 1} visible={step < 2} />
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <FilterIcon aria-hidden className="size-3.5 text-muted-foreground" />
          <DimensionChip name={copy.surface} value={copy.mobileApp} active={filtered} />
          <DimensionChip name={copy.market} value={copy.any} />
          <DimensionChip name={copy.type} value={copy.proposalsAndBugs} />
          <span className="ml-auto text-[11px] text-muted-foreground">{copy.items(visible.length)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {copy.columns.map((c, ci) => (
            <div key={ci} className="min-h-[190px] rounded-lg bg-subtle p-1.5">
              <div className="mb-1.5 px-1 text-[11px] font-medium text-muted-foreground">{c}</div>
              <div className="flex flex-col gap-1.5">
                <AnimatePresence mode="popLayout">
                  {visible
                    .filter(i => i.col === ci)
                    .map(i => (
                      <motion.div
                        key={i.id}
                        layout
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                        className={cn('rounded-md border bg-card p-1.5 text-[10px]', i.bug && 'border-bad/30')}
                      >
                        <div className="flex items-center gap-1 font-mono text-muted-foreground">
                          {i.bug ? <BugIcon aria-hidden className="size-2.5 text-bad" /> : <FileTextIcon aria-hidden className="size-2.5 text-brand" />}
                          {i.id}
                          {i.who && (
                            <span className="ml-auto">
                              <Avatar name={i.who} size={3.5} />
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 leading-snug">{copy.titles[i.id]}</div>
                      </motion.div>
                    ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      </AppWindow>
    </div>
  )
}
