import type { ReactNode } from 'react'
import { cn } from 'cn'
import type { IconComponent } from '../icon'

const tones = {
  muted: 'bg-muted text-muted-foreground',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/15 text-bad',
  merged: 'bg-[#8250df]/20 text-[#a371f7]',
}

type StatusBoxProps = {
  icon: IconComponent
  tone?: keyof typeof tones
  title: ReactNode
  description?: ReactNode
  /** The buttons that move it on. */
  actions?: ReactNode
}

/** Where something stands and what to do next, like the merge box at the end of a pull request. */
export function StatusBox({ icon: Glyph, tone = 'muted', title, description, actions }: StatusBoxProps) {
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-md border bg-card px-4 py-4 text-sm">
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', tones[tone])}>
        <Glyph aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {description !== undefined && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  )
}
