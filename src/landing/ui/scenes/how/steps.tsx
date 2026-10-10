import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { cn } from 'cn'
import type { Lang } from '../../../i18n'
import type { Story } from '../../../story'
import { ease } from '../../motion/stepper'
import { Stage, type StagesCopy } from './stages'

export type HowStep = { who: string; title: string; text: string }

type Props = { steps: HowStep[]; stages: StagesCopy; story: Story; lang: Lang }

/**
 * The story, step by step. On wide screens the steps scroll on the left while
 * the stage of the current one stays pinned on the right; on small screens
 * every step shows its own stage, inline.
 */
export function HowSteps({ steps, stages, story, lang }: Props) {
  const [active, setActive] = useState(0)
  const stageProps = { copy: stages, story, lang }
  return (
    <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-14">
      <ol className="flex min-w-0 flex-col">
        {steps.map((s, i) => (
          <StepBlock key={i} index={i} step={s} active={active === i} onActive={setActive} stageProps={stageProps} />
        ))}
      </ol>
      <div className="hidden lg:block">
        <div className="sticky top-24 flex h-[calc(100vh-8rem)] max-h-[720px] min-h-[600px] flex-col justify-center">
          <Progress active={active} count={steps.length} />
          <div className="relative mt-4 h-[540px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 16, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.985 }}
                transition={{ duration: 0.4, ease }}
                className="absolute inset-0"
              >
                <Stage step={active} {...stageProps} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

type StageProps = Omit<Props, 'steps' | 'stages'> & { copy: StagesCopy }

function StepBlock({
  index,
  step: s,
  active,
  onActive,
  stageProps,
}: {
  index: number
  step: HowStep
  active: boolean
  onActive: (index: number) => void
  stageProps: StageProps
}) {
  const ref = useRef<HTMLLIElement>(null)
  // A step is "current" while it crosses the middle of the screen.
  const inView = useInView(ref, { margin: '-45% 0px -45% 0px' })
  const activate = useCallback(() => onActive(index), [onActive, index])
  useEffect(() => {
    if (inView) activate()
  }, [inView, activate])
  return (
    <li ref={ref} className="flex flex-col justify-center py-8 lg:min-h-[64vh] lg:py-0">
      <div className={cn('transition-opacity duration-500', active ? 'lg:opacity-100' : 'lg:opacity-35')}>
        <div className="flex items-center gap-3 font-mono text-xs">
          <span
            className={cn('flex size-7 items-center justify-center rounded-full border', active ? 'border-brand text-brand' : 'text-muted-foreground')}
          >
            {index + 1}
          </span>
          <span className="tracking-widest text-muted-foreground uppercase">{s.who}</span>
        </div>
        <h3 className="mt-4 text-2xl font-semibold tracking-tight">{s.title}</h3>
        <p className="mt-3 text-pretty text-muted-foreground">{s.text}</p>
      </div>
      {/* On small screens every step shows its own stage, inline. */}
      <div className="mt-6 h-[520px] lg:hidden">
        <InlineStage step={index} stageProps={stageProps} />
      </div>
    </li>
  )
}

/** Mounts the stage only when it scrolls into view, so its animation plays then. */
function InlineStage({ step, stageProps }: { step: number; stageProps: StageProps }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  return (
    <div ref={ref} className="h-full">
      {inView && <Stage step={step} {...stageProps} />}
    </div>
  )
}

function Progress({ active, count }: { active: number; count: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <motion.span
          key={i}
          className="h-1 rounded-full"
          animate={{ width: i === active ? 36 : 14, backgroundColor: i <= active ? 'var(--brand)' : 'var(--border)' }}
          transition={{ duration: 0.4 }}
        />
      ))}
      <span className="ml-2 font-mono text-xs text-muted-foreground">
        {active + 1}/{count}
      </span>
    </div>
  )
}
