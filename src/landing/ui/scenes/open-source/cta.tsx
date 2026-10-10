import type { ReactNode } from 'react'
import { Reveal } from '../../motion/reveal'

/** The closing call to action: a big centered card with a brand glow at the top. */
export function ClosingCta({ title, text, actions }: { title: ReactNode; text: string; actions: ReactNode }) {
  return (
    <Reveal className="relative mt-16 overflow-hidden rounded-3xl border bg-card p-8 text-center sm:p-14">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--brand)_0%,transparent_60%)] opacity-15" />
      <h2 className="relative text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      <p className="relative mx-auto mt-4 max-w-xl text-muted-foreground">{text}</p>
      <div className="relative mt-8 flex flex-wrap justify-center gap-3">{actions}</div>
    </Reveal>
  )
}
