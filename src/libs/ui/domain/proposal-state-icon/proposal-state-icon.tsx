import { BanIcon, CircleDotIcon, GitMergeIcon, GitPullRequestDraftIcon, GitPullRequestIcon, CheckCircle2Icon } from 'lucide-react'
import { cn } from 'cn'
import type { ProposalState } from '../types'

const look = {
  'draft': { icon: GitPullRequestDraftIcon, className: 'text-muted-foreground' },
  'in review': { icon: GitPullRequestIcon, className: 'text-warn' },
  'accepted': { icon: CheckCircle2Icon, className: 'text-ok' },
  'merged': { icon: GitMergeIcon, className: 'text-[#a371f7]' },
  'discarded': { icon: BanIcon, className: 'text-muted-foreground' },
} satisfies Record<ProposalState, { icon: unknown, className: string }>

/** A proposal's state as an icon, coloured like a pull request's in GitHub. */
export function ProposalStateIcon({ state }: { state: ProposalState }) {
  const { icon: Glyph, className } = look[state] ?? { icon: CircleDotIcon, className: '' }
  return <Glyph aria-label={state} className={cn('size-4 shrink-0', className)} />
}
