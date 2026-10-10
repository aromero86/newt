import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { cn } from 'cn'
import { Reveal } from '../../motion/reveal'

/** The roadmap and the quickstart, side by side on wide screens. */
export function StatusRow({ children }: { children: ReactNode }) {
  return <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_1fr]">{children}</div>
}

export type RoadmapCopy = {
  title: string
  text: string
  /** The stages of the plan, in order. */
  stages: { name: string; text: string }[]
  inProgress: string
}

/** The plan's stages, lettered A to H; `now` is where development is. */
export function Roadmap({ copy, now }: { copy: RoadmapCopy; now: number }) {
  return (
    <Reveal className="rounded-2xl border bg-card p-5">
      <h3 className="font-semibold">{copy.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{copy.text}</p>
      <ol className="mt-5 space-y-2.5">
        {copy.stages.map((s, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-3 text-sm"
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]',
                i === now ? 'border-brand bg-brand text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {String.fromCharCode(65 + i)}
            </span>
            <span className={cn('font-medium', i !== now && 'text-muted-foreground')}>{s.name}</span>
            <span className="hidden truncate text-muted-foreground sm:inline">· {s.text}</span>
            {i === now && <span className="ml-auto shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] text-brand">{copy.inProgress}</span>}
          </motion.li>
        ))}
      </ol>
    </Reveal>
  )
}
