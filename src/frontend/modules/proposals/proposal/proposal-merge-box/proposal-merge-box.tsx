import { CheckCircle2Icon, CircleDashedIcon, GitMergeIcon, GitPullRequestIcon, XCircleIcon } from 'lucide-react'
import type { ProposalAction, ProposalDTO } from '@newt/api/proposal'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { StatusBox } from '@newt/ui/components/status-box'
import { useService } from '../../../../core/injector/use-service'
import { ProposalService } from '../proposal.service'

/** What the proposal needs next, and the buttons to do it: like the merge box at the end of a pull request. */
export function ProposalMergeBox({ proposal }: { proposal: ProposalDTO }) {
  const service = useService(ProposalService)
  const { deltas: counts, status } = proposal
  const ready = counts.total > 0 && counts.approved === counts.total && !proposal.unpublished
  const act = (action: ProposalAction) => () => void service.act(action)

  const state = {
    'draft': { icon: GitPullRequestIcon, tone: 'muted' as const, title: 'This proposal is a draft', text: 'Write its document and deltas in the working copy, then send it to review: that publishes its first revision.' },
    'in review': ready
      ? { icon: CheckCircle2Icon, tone: 'ok' as const, title: 'Every delta is approved', text: 'It can be accepted: it becomes the brief for development, frozen.' }
      : { icon: CircleDashedIcon, tone: 'warn' as const, title: proposal.unpublished ? 'Unpublished changes' : 'Review in progress', text: proposal.unpublished ? 'The working copy has changes no revision published: publish them or discard them before accepting.' : `${counts.approved} of ${counts.total} deltas approved: it can be accepted once every one is.` },
    'accepted': { icon: CheckCircle2Icon, tone: 'ok' as const, title: 'Accepted: the brief for development', text: 'Mark it as merged once its code is in: its deltas then enter the definition in force.' },
    'merged': { icon: GitMergeIcon, tone: 'merged' as const, title: 'Merged', text: 'Its deltas are in the definition in force.' },
    'discarded': { icon: XCircleIcon, tone: 'muted' as const, title: 'Discarded', text: 'It did not go ahead.' },
  }[status]
  return (
    <StatusBox
      icon={state.icon}
      tone={state.tone}
      title={state.title}
      description={state.text}
      actions={(
        <>
          {status === 'draft' && <><Button variant="ghost" onClick={act('discard')}>Discard</Button><Button onClick={() => void service.submit()}>Send to review</Button></>}
          {status === 'in review' && <><Button variant="ghost" onClick={act('discard')}>Discard</Button><Button variant="outline" onClick={act('draft')}>Back to draft</Button><Button disabled={!ready} onClick={act('accept')}>Accept</Button></>}
          {status === 'accepted' && <><Button variant="ghost" onClick={act('discard')}>Discard</Button><Button variant="outline" onClick={act('reopen')}>Back to review</Button><Button onClick={act('merge')}><Icon icon={GitMergeIcon} size="sm" />Mark as merged</Button></>}
        </>
      )}
    />
  )
}
