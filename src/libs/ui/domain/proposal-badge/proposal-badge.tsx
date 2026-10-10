import { BanIcon, CheckCircle2Icon, CircleDotIcon, GitMergeIcon } from 'lucide-react'
import { cn } from 'cn'
import type { ProposalState } from '../types'

// Merged is purple, like a merged pull request on GitHub.
const look: Record<ProposalState, string> = {
  draft: 'bg-muted text-muted-foreground border-transparent',
  'in review': 'bg-warn/12 text-warn border-warn/30',
  accepted: 'bg-ok/12 text-ok border-ok/30',
  merged: 'bg-[#8250df]/15 text-[#a371f7] border-[#8250df]/30',
  discarded: 'bg-muted text-muted-foreground border-transparent line-through',
}

const icon = {
  draft: CircleDotIcon,
  'in review': CircleDotIcon,
  accepted: CheckCircle2Icon,
  merged: GitMergeIcon,
  discarded: BanIcon,
} satisfies Record<ProposalState, unknown>

/** A proposal's state, as a pill. `faded` is for a state the proposal has left behind. */
export function ProposalBadge({ state, faded = false }: { state: ProposalState; faded?: boolean }) {
  const Glyph = icon[state]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        look[state],
        faded && 'opacity-60',
      )}
    >
      <Glyph aria-hidden className="size-3" /> {state}
    </span>
  )
}
