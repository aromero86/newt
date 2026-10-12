import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { CheckCircle2Icon, GitCommitHorizontalIcon, GitMergeIcon, XCircleIcon } from 'lucide-react'
import type { ProposalDTO, ProposalRevisionDTO } from '@newt/api/proposal'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Select } from '@newt/ui/components/select'
import { Text } from '@newt/ui/components/text'
import { TextLink } from '@newt/ui/components/link'
import { Timeline, TimelineItem } from '@newt/ui/components/timeline'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { ProposalRevisionsService } from './proposal-revisions.service'

/** "2 deltas added, 1 changed, document changed". */
export function revisionSummary(revision: Pick<ProposalRevisionDTO, 'added' | 'changed' | 'removed' | 'documentChanged'>): string {
  const parts = [
    revision.added && `${revision.added} ${revision.added === 1 ? 'delta' : 'deltas'} added`,
    revision.changed && `${revision.changed} changed`,
    revision.removed && `${revision.removed} removed`,
    revision.documentChanged && 'document changed',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'no changes'
}

/** What a revision did, once its deltas are extracted. */
function revisionSummaryOrState(revision: ProposalRevisionDTO): string {
  if (revision.extraction === 'extracting') return 'extracting its deltas…'
  if (revision.extraction === 'failed') return 'its deltas could not be extracted'
  return revisionSummary(revision)
}

/** Every revision, newest first, like a pull request's commits; and comparing any two. */
export function ProposalRevisions({ proposal }: { proposal: ProposalDTO }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(ProposalRevisionsService)
  const revisions = useValue(service.revisions.items)
  const hasMore = useValue(service.revisions.hasMore)
  const loadingMore = useValue(service.revisions.loadingMore)
  const [from, setFrom] = useState(String(Math.max(1, proposal.revision - 1)))
  const [to, setTo] = useState(String(proposal.revision))
  const base = `/w/${workspaceId}/proposals/${proposal.key}`
  const numbers = Array.from({ length: proposal.revision }, (_, index) => String(index + 1))

  useEffect(() => {
    void service.revisions.loadFirstPage()
  }, [service, proposal.revision, proposal.extraction?.state])

  return (
    <Box label="Revisions">
      <BoxHeader
        actions={proposal.revision > 1 && (
          <Inline gap={2}>
            <Select size="compact" label="Compare from" value={from} onValueChange={setFrom} options={numbers.map(number => ({ value: number, label: `r${number}` }))} />
            <Text size="sm" tone="muted" as="span">→</Text>
            <Select size="compact" label="Compare to" value={to} onValueChange={setTo} options={numbers.map(number => ({ value: number, label: `r${number}` }))} />
            <Button size="sm" variant="outline" href={`${base}/compare?from=${from}&to=${to}`}>Compare</Button>
          </Inline>
        )}
      >
        {`${proposal.revision} ${proposal.revision === 1 ? 'revision' : 'revisions'}`}
      </BoxHeader>
      {proposal.revision === 0 && <BoxEmpty icon={GitCommitHorizontalIcon} title="No revision published yet" description="Sending the proposal to review publishes the first one." />}
      {revisions.map(revision => (
        <BoxRow key={revision.id} leading={<Icon icon={GitCommitHorizontalIcon} tone="muted" />} trailing={<Text size="sm" tone="muted" as="span">{`r${revision.number}`}</Text>}>
          <Inline gap={2} wrap>
            <BoxRowTitle href={`${base}/revisions/${revision.number}`}>{revision.message}</BoxRowTitle>
            {revision.number === proposal.revision && <Badge tone="ok">latest</Badge>}
            {revision.extraction === 'extracting' && <Badge tone="info">extracting deltas…</Badge>}
            {revision.extraction === 'failed' && <Badge tone="bad">extraction failed</Badge>}
            {revision.assistant && <Badge tone="info">{`via ${revision.assistant}`}</Badge>}
          </Inline>
          <BoxRowMeta>
            <span>{`@${revision.publishedBy.nick} published `}<RelativeTime date={revision.publishedAt} /></span>
            <span>{revisionSummaryOrState(revision)}</span>
          </BoxRowMeta>
        </BoxRow>
      ))}
      {hasMore && <BoxFooter><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.revisions.loadMore()}>Load older revisions</Button></BoxFooter>}
    </Box>
  )
}

/** What happened to the proposal, oldest first, as a pull request's timeline: its revisions and its decisions. */
export function ProposalRevisionsTimeline({ proposal }: { proposal: ProposalDTO }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(ProposalRevisionsService)
  const revisions = useValue(service.revisions.items)
  const hasMore = useValue(service.revisions.hasMore)
  const base = `/w/${workspaceId}/proposals/${proposal.key}`

  useEffect(() => {
    void service.revisions.loadFirstPage()
  }, [service, proposal.revision, proposal.extraction?.state])

  if (proposal.revision === 0) return null

  return (
    <Timeline>
      {hasMore && <TimelineItem icon={GitCommitHorizontalIcon}><Text size="sm" tone="muted">Older revisions are in the Revisions tab.</Text></TimelineItem>}
      {[...revisions].reverse().map(revision => (
        <TimelineItem key={revision.id} icon={GitCommitHorizontalIcon} tone="brand">
          <Inline gap={1} wrap>
            <Text size="sm" weight="semibold" as="span">{`@${revision.publishedBy.nick}`}</Text>
            <Text size="sm" tone="muted" as="span">published</Text>
            <TextLink href={`${base}/revisions/${revision.number}`}>{`revision ${revision.number}`}</TextLink>
            <Text size="sm" tone="muted" as="span"><RelativeTime date={revision.publishedAt} /></Text>
            {revision.assistant && <Badge tone="info">{`via ${revision.assistant}`}</Badge>}
          </Inline>
          <Text size="sm">{revision.message}</Text>
          <Text size="sm" tone="muted">{revisionSummaryOrState(revision)}</Text>
        </TimelineItem>
      ))}
      {proposal.acceptedBy && (
        <TimelineItem icon={CheckCircle2Icon} tone="ok">
          <Inline gap={1} wrap>
            <Text size="sm" weight="semibold" as="span">{`@${proposal.acceptedBy.nick}`}</Text>
            <Text size="sm" tone="muted" as="span">accepted it <RelativeTime date={proposal.acceptedAt!} /></Text>
          </Inline>
        </TimelineItem>
      )}
      {proposal.mergedBy && (
        <TimelineItem icon={GitMergeIcon} tone="merged">
          <Inline gap={1} wrap>
            <Text size="sm" weight="semibold" as="span">{`@${proposal.mergedBy.nick}`}</Text>
            <Text size="sm" tone="muted" as="span">merged it into the definition <RelativeTime date={proposal.mergedAt!} /></Text>
          </Inline>
        </TimelineItem>
      )}
      {proposal.discardedBy && (
        <TimelineItem icon={XCircleIcon}>
          <Inline gap={1} wrap>
            <Text size="sm" weight="semibold" as="span">{`@${proposal.discardedBy.nick}`}</Text>
            <Text size="sm" tone="muted" as="span">discarded it <RelativeTime date={proposal.discardedAt!} /></Text>
          </Inline>
        </TimelineItem>
      )}
    </Timeline>
  )
}
