import { useCallback, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { ease } from '../../motion/stepper'
import { Reveal } from '../../motion/reveal'
import { GithubMark } from '../../site/icons'

export type PlayerScene = {
  id: string
  label: string
  icon: LucideIcon
  /** Renders the scene; it calls `onDone` when its timeline ends. */
  render: (onDone: () => void) => ReactNode
}

// The old landing's `animate-in fade-in slide-in-from-bottom-3 duration-500`.
const cssEase = [0.25, 0.1, 0.25, 1] as const

/** The GitHub scenes, one at a time: a pill per scene, and the current one playing. */
export function ScenePlayer({ label, scenes }: { label: string; scenes: PlayerScene[] }) {
  const reduced = useReducedMotion()
  const [current, setCurrent] = useState(0)
  const next = useCallback(() => setCurrent(c => (c + 1) % scenes.length), [scenes.length])
  const scene = scenes[current]!

  return (
    <Reveal>
      <div role="tablist" aria-label={label} className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {scenes.map((s, i) => {
          const Icon = s.icon
          const active = i === current
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="github-scene"
              onClick={() => setCurrent(i)}
              className={cn(
                'relative isolate flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                active ? 'border-brand/40 text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && <motion.span layoutId="github-scene-pill" className="absolute inset-0 -z-10 rounded-full bg-brand/10" transition={{ duration: 0.35, ease }} />}
              <Icon className={cn('size-4', active && 'text-brand')} />
              {s.label}
            </button>
          )
        })}
      </div>

      <div id="github-scene" role="tabpanel" className="relative">
        {/* Keyed: a new scene remounts, plays its entrance and starts its own timeline. */}
        <motion.div
          key={scene.id}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: cssEase }}
        >
          {scene.render(next)}
        </motion.div>
      </div>
    </Reveal>
  )
}

/** The three short promises under the scenes. */
export function GithubCards({ cards }: { cards: { title: string; text: string }[] }) {
  return (
    <Reveal className="mt-14 grid gap-4 sm:grid-cols-3">
      {cards.map(card => (
        <div key={card.title} className="rounded-xl border bg-card/60 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <GithubMark className="size-4" /> {card.title}
          </div>
          <p className="text-sm text-muted-foreground">{card.text}</p>
        </div>
      ))}
    </Reveal>
  )
}
