import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from 'cn'
import { useStepper } from '../../motion/stepper'

/** How long each step of a role's scenario stays on screen. */
export const STEP_MS = 3000

const durationOf = (step: number, count: number) => (step === count - 1 ? STEP_MS * 2 : STEP_MS) / 1000

export type StageCopy = {
  /** Accessible name of the list of steps. */
  steps: string
  /** "Step", before a step's number on the phone dots. */
  step: string
}

/**
 * One role's scenario: the steps told in words on one side, the scene acted out
 * on the other. Plays on its own while visible; any step can be picked by hand.
 * On phones the step list folds into a compact bar above the scene.
 */
export function Stage({ steps, copy, children }: { steps: string[]; copy: StageCopy; children: (step: number) => ReactNode }) {
  const stepper = useStepper(steps.length, { interval: STEP_MS, hold: 2 })
  const { ref, reduced } = stepper
  // With reduced motion the shared stepper always shows the last step; a step
  // picked by hand still has to show up.
  const [picked, setPicked] = useState<number | null>(null)
  const step = reduced && picked !== null ? picked : stepper.step
  const setStep = (n: number) => {
    setPicked(n)
    stepper.setStep(n)
  }

  return (
    <div ref={ref} className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
      <ol className="hidden flex-col gap-1 lg:flex" aria-label={copy.steps}>
        {steps.map((text, i) => {
          const current = i === step
          return (
            <li key={text}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'relative flex w-full gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                  current ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
                  i > step && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]',
                    i < step && 'border-brand/40 bg-brand/15 text-brand',
                    current && 'border-brand bg-brand text-primary-foreground',
                  )}
                >
                  {i + 1}
                </span>
                <span className="leading-snug">{text}</span>
                {current && !reduced && <Progress step={step} count={steps.length} />}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="flex min-w-0 flex-col gap-4">
        <CompactSteps steps={steps} step={step} setStep={setStep} reduced={reduced} label={copy.step} />
        <div className="relative min-h-[360px] min-w-0 sm:min-h-[480px]">{children(step)}</div>
      </div>
    </div>
  )
}

/** Phones: the current step in words, its progress, and dots to jump between steps. */
function CompactSteps({ steps, step, setStep, reduced, label }: { steps: string[]; step: number; setStep: (n: number) => void; reduced: boolean; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-card px-3.5 py-3 ring-1 ring-border lg:hidden">
      <p className="text-sm leading-snug" aria-live="polite">
        <span className="mr-1.5 font-mono text-xs text-brand">
          {step + 1}/{steps.length}
        </span>
        {steps[step]}
      </p>
      <div className="mt-2.5 flex gap-1.5">
        {steps.map((text, i) => (
          <button
            key={text}
            type="button"
            onClick={() => setStep(i)}
            aria-label={`${label} ${i + 1}: ${text}`}
            aria-current={i === step ? 'step' : undefined}
            className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= step ? 'bg-brand/70' : 'bg-muted')}
          />
        ))}
      </div>
      {!reduced && <Progress step={step} count={steps.length} />}
    </div>
  )
}

/** A thin bar that fills while a step is on screen. */
function Progress({ step, count }: { step: number; count: number }) {
  return (
    <motion.span
      key={`progress-${step}`}
      aria-hidden
      className="absolute bottom-0 left-0 h-0.5 bg-brand/70"
      initial={{ width: '0%' }}
      animate={{ width: '100%' }}
      transition={{ duration: durationOf(step, count), ease: 'linear' }}
    />
  )
}
