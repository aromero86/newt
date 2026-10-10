import { BugIcon } from 'lucide-react'
import { cn } from 'cn'
import type { BugState } from '../types'

const look: Record<BugState, string> = {
  reported: 'bg-warn/12 text-warn border-warn/30',
  confirmed: 'bg-bad/12 text-bad border-bad/30',
  resolved: 'bg-ok/12 text-ok border-ok/30',
  dismissed: 'bg-muted text-muted-foreground border-transparent',
}

/** A bug's state, as a pill. */
export function BugBadge({ state }: { state: BugState }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', look[state])}>
      <BugIcon aria-hidden className="size-3" /> {state}
    </span>
  )
}
