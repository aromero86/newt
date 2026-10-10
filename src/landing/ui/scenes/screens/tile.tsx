import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Reveal } from '../../motion/reveal'

/** The tiles' layout: one column, then five where tiles span three or two. */
export function ScreenGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 lg:grid-cols-5">{children}</div>
}

/** One screen of the app, with what it is and why it matters above it. */
export function ScreenTile({ title, text, span, children }: { title: string; text: string; span: 2 | 3; children: ReactNode }) {
  return (
    <Reveal className={cn('flex min-w-0 flex-col rounded-2xl border bg-card/50 p-4 sm:p-5', span === 3 ? 'lg:col-span-3' : 'lg:col-span-2')}>
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
      <div>{children}</div>
    </Reveal>
  )
}
