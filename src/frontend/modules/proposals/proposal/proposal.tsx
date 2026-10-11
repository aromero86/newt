import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { CheckCircle2Icon, CircleDashedIcon, CircleHelpIcon, GitMergeIcon, GitPullRequestIcon, HighlighterIcon, XCircleIcon, ZapIcon } from 'lucide-react'
import type { ProposalAction, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Avatar } from '@newt/ui/components/avatar'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxFooter, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Markdown } from '@newt/ui/components/markdown'
import { PageTitle } from '@newt/ui/components/page-title'
import { Quote } from '@newt/ui/components/quote'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { SidebarLayout, SidebarSection } from '@newt/ui/components/sidebar-layout'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { StatusBox } from '@newt/ui/components/status-box'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@newt/ui/components/tabs'
import { Text } from '@newt/ui/components/text'
import { Strong } from '@newt/ui/components/text'
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
import { ProposalRevisions, ProposalRevisionsTimeline } from './proposal-revisions/proposal-revisions'
import { ProposalRevisionsService } from './proposal-revisions/proposal-revisions.service'
import { ProposalMergeBox } from './proposal-merge-box/proposal-merge-box'
import { ProposalWorking } from './proposal-working/proposal-working'
import { ProposalService } from './proposal.service'

/** With its own services: whoever renders it needs nothing else. */
export function Proposal() {
  return (
    <Provide services={[ArtifactNamesService, ProposalService, ProposalRevisionsService]}>
      <ProposalWrapped />
    </Provide>
  )
}

/** One proposal, like a pull request: its conversation, its deltas, its working copy and its revisions. */
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

  return (
    <Stack gap={6}>
      <Stack gap={3}>
        <PageTitle reference={proposal.key}>{proposal.title}</PageTitle>
        <Inline gap={2} wrap>
          <ProposalBadge state={proposal.status} />
          <Text size="sm" tone="muted" as="span">
            <Strong>{`@${proposal.createdBy.nick}`}</Strong>
            {' opened this '}
            <RelativeTime date={proposal.createdAt} />
            {proposal.revision ? ` · revision ${proposal.revision}` : ' · not published yet'}
          </Text>
          {proposal.quick && <Badge tone="outline"><Icon icon={ZapIcon} size="sm" />quick proposal</Badge>}
          {proposal.unpublished && proposal.revision > 0 && <Badge tone="warn">unpublished changes</Badge>}
        </Inline>
      </Stack>
      <Tabs defaultValue={proposal.revision > 0 ? 'conversation' : 'working'} variant="underline">
        <TabsList label="Proposal">
          <TabsTrigger value="conversation">Conversation</TabsTrigger>
          <TabsTrigger value="deltas" count={proposal.deltas.total}>Deltas</TabsTrigger>
          <TabsTrigger value="working">{proposal.unpublished ? 'Working copy •' : 'Working copy'}</TabsTrigger>
          <TabsTrigger value="revisions" count={proposal.revision}>Revisions</TabsTrigger>
        </TabsList>
        <TabsContent value="conversation"><ProposalConversation proposal={proposal} readOnly={readOnly} /></TabsContent>
        <TabsContent value="deltas"><ProposalDeltas proposal={proposal} readOnly={readOnly} /></TabsContent>
        <TabsContent value="working"><ProposalWorking proposal={proposal} /></TabsContent>
        <TabsContent value="revisions"><ProposalRevisions proposal={proposal} /></TabsContent>
      </Tabs>
      <ProposalReject />
      <ProposalSubmit />
    </Stack>
  )
}

/** The document, what happened since, the conversations and what to do next; with the proposal's facts beside. */
function ProposalConversation({ proposal, readOnly }: { proposal: ProposalDTO, readOnly: boolean }) {
  const service = useService(ProposalService)
  const document = useValue(service.publishedDocument)
  const deltas = useValue(service.deltas.items)
  const [showSources, setShowSources] = useState(false)
  const sources = deltas.flatMap(delta => delta.sources)

  return (
    <SidebarLayout side="end" aside={<ProposalSidebar proposal={proposal} />}>
      <Stack gap={6}>
        <Box label="Document">
          <BoxHeader actions={proposal.revision > 0 && sources.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setShowSources(!showSources)}>
              <Icon icon={HighlighterIcon} size="sm" />
              {showSources ? 'Hide where the deltas come from' : 'Show where the deltas come from'}
            </Button>
          )}
          >
            <Inline gap={2}>
              <Avatar name={proposal.createdBy.nick} size={5} />
              <Text size="sm" weight="semibold" as="span">{`@${proposal.createdBy.nick}`}</Text>
              <Text size="sm" tone="muted" as="span">wrote the document</Text>
            </Inline>
          </BoxHeader>
          <BoxBody>
            {proposal.revision === 0
              ? <Text size="sm" tone="muted">Nothing published yet: write the document in the working copy, then send it to review. newt reads its deltas from it.</Text>
              : document ? <Markdown highlights={showSources ? sources : undefined}>{document}</Markdown> : <Text size="sm" tone="muted">No document.</Text>}
          </BoxBody>
        </Box>
        <ProposalQuestions proposal={proposal} />
        <ProposalRevisionsTimeline proposal={proposal} />
        <ProposalDiscussions readOnly={readOnly} />
        {!readOnly && <ProposalMergeBox proposal={proposal} />}
      </Stack>
    </SidebarLayout>
  )
}

/** What reading the last revision could not settle: its author answers it in the document. */
function ProposalQuestions({ proposal }: { proposal: ProposalDTO }) {
  const revisions = useValue(useService(ProposalRevisionsService).revisions.items)
  const last = revisions.find(revision => revision.number === proposal.revision)
  if (!last || last.questions.length === 0) return null

  return (
    <Box label="Questions from the document">
      <BoxHeader>
        <Inline gap={2}>
          <Icon icon={CircleHelpIcon} size="sm" tone="muted" />
          {`The document leaves ${last.questions.length === 1 ? 'a question' : `${last.questions.length} questions`} open`}
        </Inline>
      </BoxHeader>
      {last.questions.map(question => (
        <BoxRow key={question.question}>
          <Stack gap={2}>
            <Text size="sm">{question.question}</Text>
            {question.sources.map(source => <Quote key={source}>{source}</Quote>)}
          </Stack>
        </BoxRow>
      ))}
      <BoxFooter><Text size="xs" tone="muted">{`Read from revision ${last.number}. Answer them in the document: the next revision reads it again.`}</Text></BoxFooter>
    </Box>
  )
}

/** Every delta as the last revision published it, like the files a pull request changes. */
function ProposalDeltas({ proposal, readOnly }: { proposal: ProposalDTO, readOnly: boolean }) {
  const service = useService(ProposalService)
  const deltas = useValue(service.deltas.items)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)
  const { deltas: counts } = proposal

  if (proposal.revision === 0) return <Text size="sm" tone="muted">Nothing published yet: its deltas are in the working copy.</Text>

  return (
    <Stack gap={4}>
      <Inline gap={4} wrap>
        <Text size="sm" tone="muted" as="span">{`${counts.total} ${counts.total === 1 ? 'delta' : 'deltas'} in revision ${proposal.revision}`}</Text>
        <Inline gap={1}><Icon icon={CheckCircle2Icon} size="sm" tone="ok" /><Text size="sm" as="span">{`${counts.approved} approved`}</Text></Inline>
        <Inline gap={1}><Icon icon={XCircleIcon} size="sm" tone="bad" /><Text size="sm" as="span">{`${counts.rejected} rejected`}</Text></Inline>
        <Inline gap={1}><Icon icon={CircleDashedIcon} size="sm" tone="warn" /><Text size="sm" as="span">{`${counts.pending} pending`}</Text></Inline>
      </Inline>
      {deltas.map(delta => <ProposalDelta key={delta.id} delta={delta} proposal={proposal} readOnly={readOnly} />)}
      {hasMore && <Inline><Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></Inline>}
    </Stack>
  )
}

/** The facts beside the conversation: where it stands, its deltas, its revisions, its people. */
function ProposalSidebar({ proposal }: { proposal: ProposalDTO }) {
  const { deltas: counts } = proposal
  const people = [
    { role: 'Opened by', person: proposal.createdBy, at: proposal.createdAt },
    proposal.acceptedBy && { role: 'Accepted by', person: proposal.acceptedBy, at: proposal.acceptedAt! },
    proposal.mergedBy && { role: 'Merged by', person: proposal.mergedBy, at: proposal.mergedAt! },
    proposal.discardedBy && { role: 'Discarded by', person: proposal.discardedBy, at: proposal.discardedAt! },
  ].filter(Boolean) as { role: string, person: { nick: string }, at: string }[]

  return (
    <div>
      <SidebarSection title="State"><ProposalBadge state={proposal.status} /></SidebarSection>
      <SidebarSection title="Deltas">
        <Stack gap={1}>
          <Inline gap={2}><Icon icon={CheckCircle2Icon} size="sm" tone="ok" /><Text size="sm" as="span">{`${counts.approved} of ${counts.total} approved`}</Text></Inline>
          {counts.rejected > 0 && <Inline gap={2}><Icon icon={XCircleIcon} size="sm" tone="bad" /><Text size="sm" as="span">{`${counts.rejected} rejected`}</Text></Inline>}
          {counts.pending > 0 && <Inline gap={2}><Icon icon={CircleDashedIcon} size="sm" tone="warn" /><Text size="sm" as="span">{`${counts.pending} pending`}</Text></Inline>}
        </Stack>
      </SidebarSection>
      <SidebarSection title="Revisions">
        <Text size="sm" tone={proposal.revision ? 'default' : 'muted'}>{proposal.revision ? `${proposal.revision} published${proposal.unpublished ? ', and unpublished changes' : ''}` : 'None published yet'}</Text>
      </SidebarSection>
      <SidebarSection title="People">
        <Stack gap={2}>
          {people.map(({ role, person, at }) => (
            <Inline key={role} gap={2}>
              <Avatar name={person.nick} size={5} />
              <Text size="sm" as="span">{`@${person.nick}`}</Text>
              <Text size="sm" tone="muted" as="span">{role.split(' ')[0]!.toLowerCase()} <RelativeTime date={at} /></Text>
            </Inline>
          ))}
        </Stack>
      </SidebarSection>
    </div>
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
    <Dialog open={rejecting !== null} onOpenChange={open => !open && service.closeReject()} title={`Reject ${rejecting?.targetLabel ?? ''}`} description="Say why: whoever wrote it will read it." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.rejectForm} name="reason" label="Why" rows={3} />
          <Inline justify="end"><Button type="submit" variant="destructive" loading={submitting}>Reject</Button></Inline>
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
  const failure = useValue(service.submitForm.failure)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.confirmSubmit()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closeSubmit()} title="Publish and send to review" description="The working copy becomes a revision that reviewers see, with the deltas newt reads from its document." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Not sent">{failure}</Alert>}
          <FormField form={service.submitForm} name="message" label="Message" description="Like a commit: what this revision is." />
          <Inline justify="end" gap={3}>
            {sending && <Text size="sm" tone="muted">Reading the document for its deltas…</Text>}
            <Button type="submit" loading={sending}>Publish and send</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
