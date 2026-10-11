import type { ReactNode } from 'react'
import { cn } from 'cn'
import type { IconComponent } from '../icon'

/** Events in order, on a line, like the conversation of a pull request. */
export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="relative ml-4 border-l pl-6">{children}</ol>
}

const tones = {
  muted: 'bg-muted text-muted-foreground',
  brand: 'bg-brand/15 text-brand',
  ok: 'bg-ok/15 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/15 text-bad',
  info: 'bg-info/15 text-info',
  merged: 'bg-[#8250df]/20 text-[#a371f7]',
}

/** One event: an icon on the line, and what happened. */
export function TimelineItem({ icon: Glyph, tone = 'muted', children }: { icon: IconComponent, tone?: keyof typeof tones, children: ReactNode }) {
  return (
    <li className="relative pb-5 text-sm last:pb-0">
      <span className={cn('absolute top-0 -left-[37px] flex size-6 items-center justify-center rounded-full ring-4 ring-background', tones[tone])}>
        <Glyph aria-hidden className="size-3.5" />
      </span>
      <div className="min-w-0 pt-0.5">{children}</div>
    </li>
  )
}
