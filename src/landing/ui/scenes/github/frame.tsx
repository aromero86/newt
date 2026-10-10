import { useEffect, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from 'cn'
import { useStepper } from '../../motion/stepper'
import type { Story } from '../../../story'

/** What every scene receives: its copy, the story, and how to hand over to the next one. */
export type SceneProps<Copy> = { copy: Copy; story: Story; onDone: () => void }

/**
 * A scene's timeline: plays once while on screen, holds the last step, then
 * hands over to the next scene. With reduced motion it shows the last step and
 * stays there.
 */
export function useScene(count: number, onDone: () => void, interval = 2600) {
  const stepper = useStepper(count, { interval, loop: false })
  const { step, reduced } = stepper
  useEffect(() => {
    if (reduced || step !== count - 1) return
    const id = setTimeout(onDone, interval * 2.2)
    return () => clearTimeout(id)
  }, [step, reduced, count, interval, onDone])
  return stepper
}

/** The window on the left, what each step means on the right. */
export function Frame({ stepper, captions, children }: { stepper: ReturnType<typeof useStepper>; captions: string[]; children: ReactNode }) {
  const { ref, step, setStep } = stepper
  return (
    <div ref={ref} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-8">
      {/* Small screens: only the current step, with its position. */}
      <div className="lg:hidden" aria-live="polite">
        <div className="mb-2 flex items-center gap-1.5" aria-hidden>
          {captions.map((_, i) => (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              onClick={() => setStep(i)}
              className={cn('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-brand' : 'bg-muted')}
            />
          ))}
        </div>
        <p className="text-sm">
          <span className="mr-2 font-mono text-[11px] text-brand">
            {step + 1}/{captions.length}
          </span>
          {captions[step]}
        </p>
      </div>

      <div aria-hidden className="relative min-w-0 lg:min-h-[34rem]">
        {children}
      </div>

      {/* Large screens: every step, the current one highlighted; click to jump. */}
      <ol className="hidden lg:flex lg:flex-col lg:gap-2">
        {captions.map((caption, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                i === step
                  ? 'border-brand/40 bg-brand/8 text-foreground'
                  : i < step
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/70 hover:text-muted-foreground',
              )}
            >
              <span className={cn('mr-2 font-mono text-[11px]', i === step ? 'text-brand' : 'text-muted-foreground/60')}>{String(i + 1).padStart(2, '0')}</span>
              {caption}
              {i === step && <motion.span layoutId="github-caption-bar" className="absolute inset-y-0 left-0 w-0.5 bg-brand" transition={{ duration: 0.3 }} />}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
