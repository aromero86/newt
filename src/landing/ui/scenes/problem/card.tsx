import type { ReactNode } from 'react'
import { Reveal } from '../../motion/reveal'

/** One pain point: a small looping picture on top, a title and a sentence below. */
export function ProblemCard({ title, text, delay, children }: { title: string; text: string; delay: number; children: ReactNode }) {
  return (
    <Reveal delay={delay} className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="relative h-44 border-b bg-subtle" aria-hidden>
        {children}
      </div>
      <div className="p-5">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
      </div>
    </Reveal>
  )
}
