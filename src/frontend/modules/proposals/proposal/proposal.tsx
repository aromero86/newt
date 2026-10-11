import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import type { ProposalAction, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Dialog } from '@newt/ui/components/dialog'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Markdown } from '@newt/ui/components/markdown'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@newt/ui/components/tabs'
import { Text } from '@newt/ui/components/text'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { ProposalDelta } from './proposal-delta/proposal-delta'
import { ProposalDiscussions } from './proposal-discussions/proposal-discussions'
import { ProposalRevisions } from './proposal-revisions/proposal-revisions'
import { ProposalWorking } from './proposal-working/proposal-working'
import { ProposalService } from './proposal.service'

/** With its own services: whoever renders it needs nothing else. */
export function Proposal() {
  return (
    <Provide services={[ArtifactNamesService, ProposalService]}>
      <ProposalWrapped />
    </Provide>
  )
}

/** The lifecycle actions each state offers, the main one first. `submit` sends to review. */
const ACTIONS: Record<ProposalDTO['status'], { action: ProposalAction | 'submit', label: string }[]> = {
  'draft': [{ action: 'submit', label: 'Send to review' }, { action: 'discard', label: 'Discard' }],
  'in review': [{ action: 'accept', label: 'Accept' }, { action: 'draft', label: 'Back to draft' }, { action: 'discard', label: 'Discard' }],
  'accepted': [{ action: 'merge', label: 'Mark as merged' }, { action: 'reopen', label: 'Back to review' }, { action: 'discard', label: 'Discard' }],
  'merged': [],
  'discarded': [],
}

/** One proposal: what reviewers see, its working copy and its revisions. */
function ProposalWrapped() {
  const { workspaceId, key } = useParams() as { workspaceId: string, key: string }
  const service = useService(ProposalService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const proposal = useValue(service.proposal)

  useEffect(() => {
    void service.load(workspaceId, key)
  }, [service, workspaceId, key])

  if (proposal === undefined) return <Spinner label="Loading the proposal" />
  if (proposal === null) return <NotFound />

  const readOnly = Boolean(workspace?.archivedAt)
  const { deltas: counts } = proposal
  const ready = counts.total > 0 && counts.approved === counts.total && !proposal.unpublished

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <TextLink href={`/w/${workspaceId}/proposals`}>All proposals</TextLink>
        <PageHeader
          title={proposal.title}
          description={`${proposal.key} · opened by @${proposal.createdBy.nick}${proposal.quick ? ' · quick proposal' : ''}${proposal.revision ? ` · revision ${proposal.revision}` : ' · not published yet'}`}
          actions={(
            <Inline gap={2}>
              {proposal.unpublished && proposal.revision > 0 && <Badge tone="warn">unpublished changes</Badge>}
              <ProposalBadge state={proposal.status} />
            </Inline>
          )}
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
                onClick={() => void (action === 'submit' ? service.submit() : service.act(action))}
              >
                {label}
              </Button>
            ))}
          </Inline>
          {proposal.status === 'in review' && !ready && (
            <Text size="sm" tone="muted">
              {proposal.unpublished
                ? 'The working copy has unpublished changes: publish them or discard them before accepting.'
                : `It can be accepted once every delta is approved: ${counts.approved} of ${counts.total} so far.`}
            </Text>
          )}
          {proposal.status === 'accepted' && (
            <Text size="sm" tone="muted">It is the brief for development. Mark it as merged once its code is in: its deltas then enter the definition.</Text>
          )}
        </Stack>
      )}
      <Tabs defaultValue={proposal.revision > 0 ? 'review' : 'working'}>
        <TabsList label="Proposal">
          <TabsTrigger value="review">{proposal.revision > 0 ? `Review · revision ${proposal.revision}` : 'Review'}</TabsTrigger>
          <TabsTrigger value="working">{proposal.unpublished ? 'Working copy •' : 'Working copy'}</TabsTrigger>
          <TabsTrigger value="revisions">{`Revisions (${proposal.revision})`}</TabsTrigger>
        </TabsList>
        <TabsContent value="review"><ProposalReview proposal={proposal} readOnly={readOnly} /></TabsContent>
        <TabsContent value="working"><ProposalWorking proposal={proposal} /></TabsContent>
        <TabsContent value="revisions"><ProposalRevisions proposal={proposal} /></TabsContent>
      </Tabs>
      <ProposalReject />
      <ProposalSubmit />
    </Stack>
  )
}

/** What reviewers see: the document and the deltas as the last revision published them. */
function ProposalReview({ proposal, readOnly }: { proposal: ProposalDTO, readOnly: boolean }) {
  const service = useService(ProposalService)
  const document = useValue(service.publishedDocument)
  const deltas = useValue(service.deltas.items)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)
  const general = useValue(service.discussionCounts)['']
  const { deltas: counts } = proposal

  if (proposal.revision === 0) {
    return <Alert tone="info" title="Nothing published yet">Write the document and the deltas in the working copy; sending it to review publishes the first revision.</Alert>
  }

  return (
    <Stack gap={6}>
      <Card title="Document" titleLevel={2}>
        {document ? <Markdown>{document}</Markdown> : <Text size="sm" tone="muted">No document.</Text>}
      </Card>
      <Stack gap={4}>
        <Text weight="semibold">{`Deltas (${counts.total}) · ${counts.approved} approved · ${counts.rejected} rejected · ${counts.pending} pending`}</Text>
        {deltas.map(delta => <ProposalDelta key={delta.id} delta={delta} proposal={proposal} readOnly={readOnly} />)}
        {hasMore && <Inline><Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></Inline>}
      </Stack>
      <Card title={`Conversation (${general?.discussions ?? 0})`} titleLevel={2} description="About the proposal as a whole.">
        <ProposalDiscussions readOnly={readOnly} />
      </Card>
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

/** Sending to review publishes the working copy first: this asks for the revision's message. */
function ProposalSubmit() {
  const service = useService(ProposalService)
  const open = useValue(service.submitting)
  const sending = useValue(service.submitForm.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.confirmSubmit()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closeSubmit()} title="Publish and send to review" description="The working copy becomes a revision that reviewers see." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4} align="start">
          <FormField form={service.submitForm} name="message" label="Message" description="Like a commit: what this revision is." />
          <Button type="submit" loading={sending}>Publish and send</Button>
        </Stack>
      </form>
    </Dialog>
  )
}
