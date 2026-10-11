import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import type { ProposalDTO } from '@newt/api/proposal'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Field } from '@newt/ui/components/field'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Select } from '@newt/ui/components/select'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { ProposalRevisionsService } from './proposal-revisions.service'

/** With its own ProposalRevisionsService: whoever renders it needs nothing else. */
export function ProposalRevisions({ proposal }: { proposal: ProposalDTO }) {
  return (
    <Provide services={[ProposalRevisionsService]}>
      <ProposalRevisionsWrapped proposal={proposal} />
    </Provide>
  )
}

/** Every revision, newest first, with what it changed; and comparing any two. */
function ProposalRevisionsWrapped({ proposal }: { proposal: ProposalDTO }) {
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
  }, [service, proposal.revision])

  if (proposal.revision === 0) return <Text size="sm" tone="muted">No revision published yet: sending it to review publishes the first one.</Text>

  return (
    <Stack gap={6}>
      {proposal.revision > 1 && (
        <Card title="Compare two revisions" titleLevel={2}>
          <Inline gap={4} align="end" wrap>
            <Field label="From"><Select value={from} onValueChange={setFrom} options={numbers.map(number => ({ value: number, label: `Revision ${number}` }))} /></Field>
            <Field label="To"><Select value={to} onValueChange={setTo} options={numbers.map(number => ({ value: number, label: `Revision ${number}` }))} /></Field>
            <Button variant="outline" href={`${base}/compare?from=${from}&to=${to}`}>Compare</Button>
          </Inline>
        </Card>
      )}
      <Stack gap={4}>
        {revisions.map(revision => (
          <Stack key={revision.id} gap={1}>
            <Inline gap={2} wrap>
              <TextLink href={`${base}/revisions/${revision.number}`}>{`Revision ${revision.number}: ${revision.message}`}</TextLink>
              {revision.number === proposal.revision && <Badge tone="ok">latest</Badge>}
            </Inline>
            <Text size="sm" tone="muted">
              {`@${revision.publishedBy.nick} · ${new Date(revision.publishedAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })} · ${summary(revision)}`}
            </Text>
          </Stack>
        ))}
        {hasMore && <Inline><Button size="sm" variant="outline" loading={loadingMore} onClick={() => void service.revisions.loadMore()}>Load older revisions</Button></Inline>}
      </Stack>
    </Stack>
  )
}

/** "2 deltas added, 1 changed, document changed". */
function summary(revision: { added: number, changed: number, removed: number, documentChanged: boolean }): string {
  const parts = [
    revision.added && `${revision.added} ${revision.added === 1 ? 'delta' : 'deltas'} added`,
    revision.changed && `${revision.changed} changed`,
    revision.removed && `${revision.removed} removed`,
    revision.documentChanged && 'document changed',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'no changes'
}
