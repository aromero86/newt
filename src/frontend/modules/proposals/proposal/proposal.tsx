import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import type { ProposalAction, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { ProposalDelta } from './proposal-delta/proposal-delta'
import { ProposalDeltaAdd } from './proposal-delta-add/proposal-delta-add'
import { ProposalService } from './proposal.service'

/** With its own ProposalService: whoever renders it needs nothing else. */
export function Proposal() {
  return (
    <Provide services={[ProposalService]}>
      <ProposalWrapped />
    </Provide>
  )
}

/** The lifecycle actions each state offers, the main one first. */
const ACTIONS: Record<ProposalDTO['status'], { action: ProposalAction, label: string }[]> = {
  'draft': [{ action: 'submit', label: 'Send to review' }, { action: 'discard', label: 'Discard' }],
  'in review': [{ action: 'accept', label: 'Accept' }, { action: 'draft', label: 'Back to draft' }, { action: 'discard', label: 'Discard' }],
  'accepted': [{ action: 'merge', label: 'Mark as merged' }, { action: 'reopen', label: 'Back to review' }, { action: 'discard', label: 'Discard' }],
  'merged': [],
  'discarded': [],
}

/** One proposal: its state, its deltas and their verdicts. */
function ProposalWrapped() {
  const { workspaceId, key } = useParams() as { workspaceId: string, key: string }
  const service = useService(ProposalService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const proposal = useValue(service.proposal)
  const deltas = useValue(service.deltas.items)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, key)
  }, [service, workspaceId, key])

  if (proposal === undefined) return <Spinner label="Loading the proposal" />
  if (proposal === null) return <NotFound />

  const readOnly = Boolean(workspace?.archivedAt)
  const { deltas: counts } = proposal
  const editable = proposal.status === 'draft' || proposal.status === 'in review'
  const ready = counts.total > 0 && counts.approved === counts.total

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <TextLink href={`/w/${workspaceId}/proposals`}>All proposals</TextLink>
        <PageHeader
          title={proposal.title}
          description={`${proposal.key} · opened by @${proposal.createdBy.nick}${proposal.quick ? ' · quick proposal' : ''}`}
          actions={<ProposalBadge state={proposal.status} />}
        />
      </Stack>
      <ProposalHistory proposal={proposal} />
      {!readOnly && ACTIONS[proposal.status].length > 0 && (
        <Stack gap={2}>
          <Inline gap={2} wrap>
            {ACTIONS[proposal.status].map(({ action, label }, index) => (
              <Button
                key={action}
                variant={index === 0 ? 'primary' : action === 'discard' ? 'ghost' : 'outline'}
                disabled={action === 'accept' && !ready}
                onClick={() => void service.act(action)}
              >
                {label}
              </Button>
            ))}
          </Inline>
          {proposal.status === 'in review' && !ready && (
            <Text size="sm" tone="muted">{`It can be accepted once every delta is approved: ${counts.approved} of ${counts.total} so far.`}</Text>
          )}
          {proposal.status === 'accepted' && (
            <Text size="sm" tone="muted">It is the brief for development. Mark it as merged once its code is in: its deltas then enter the definition.</Text>
          )}
        </Stack>
      )}
      <Stack gap={4}>
        <Text weight="semibold">{`Deltas (${counts.total}) · ${counts.approved} approved · ${counts.rejected} rejected · ${counts.pending} pending`}</Text>
        {deltas.length === 0 && <Text size="sm" tone="muted">No deltas yet: each one is a change to one artifact of the definition.</Text>}
        {deltas.map(delta => <ProposalDelta key={delta.id} delta={delta} proposal={proposal} readOnly={readOnly} />)}
        {hasMore && (
          <Inline>
            <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button>
          </Inline>
        )}
        {editable && !readOnly && <ProposalDeltaAdd />}
      </Stack>
      <ProposalReject />
    </Stack>
  )
}

/** Who accepted, merged or discarded it, and when. */
function ProposalHistory({ proposal }: { proposal: ProposalDTO }) {
  const when = (at: string | null) => (at ? new Date(at).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : '')
  const lines = [
    proposal.acceptedBy && `Accepted by @${proposal.acceptedBy.nick} on ${when(proposal.acceptedAt)}`,
    proposal.mergedBy && `Merged by @${proposal.mergedBy.nick} on ${when(proposal.mergedAt)}`,
    proposal.discardedBy && `Discarded by @${proposal.discardedBy.nick} on ${when(proposal.discardedAt)}`,
  ].filter(Boolean) as string[]
  if (lines.length === 0) return null
  return (
    <Alert tone={proposal.status === 'discarded' ? 'warn' : 'ok'} title={lines[lines.length - 1]!}>
      {lines.length > 1 ? lines.slice(0, -1).join(' · ') : undefined}
    </Alert>
  )
}

/** Says why a delta is rejected. */
function ProposalReject() {
  const service = useService(ProposalService)
  const rejecting = useValue(service.rejecting)
  const submitting = useValue(service.rejectForm.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.reject()
  }

  return (
    <Dialog open={rejecting !== null} onOpenChange={open => !open && service.closeReject()} title={`Reject ${rejecting?.targetLabel ?? ''}`} size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4} align="start">
          <FormField form={service.rejectForm} name="reason" label="Why" rows={3} />
          <Button type="submit" variant="destructive" loading={submitting}>Reject</Button>
        </Stack>
      </form>
    </Dialog>
  )
}
