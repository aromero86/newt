import { CheckCircle2Icon, CircleDashedIcon, XCircleIcon } from 'lucide-react'
import { cn } from 'cn'
import type { DeltaState } from '../types'

const look: Record<DeltaState, string> = {
  pending: 'text-warn',
  approved: 'text-ok',
  rejected: 'text-bad',
}

const icon = {
  pending: CircleDashedIcon,
  approved: CheckCircle2Icon,
  rejected: XCircleIcon,
} satisfies Record<DeltaState, unknown>

/** A delta's approval state. */
export function DeltaBadge({ state }: { state: DeltaState }) {
  const Glyph = icon[state]
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap', look[state])}>
      <Glyph aria-hidden className="size-3.5" /> {state}
    </span>
  )
}
