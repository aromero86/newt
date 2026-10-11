import { useEffect } from 'react'
import { useParams } from 'react-router'
import type { DeltaSnapshotDTO } from '@newt/api/proposal'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { TextDiff } from '@newt/ui/components/text-diff'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaChanges, DeltaStateChanges } from '../../../components/delta-changes'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'
import { KIND_LABEL, OPERATION_LABEL } from '../proposal/proposal-delta/proposal-delta'
import { ProposalRevisionService } from './proposal-revision.service'

const CHANGE_TONE = { added: 'ok', changed: 'warn', removed: 'bad', unchanged: 'muted' } as const

/** With its own services: whoever renders it needs nothing else. */
export function ProposalRevision() {
  return (
    <Provide services={[ArtifactNamesService, ProposalRevisionService]}>
      <ProposalRevisionWrapped />
    </Provide>
  )
}

/** One revision: its message, and what it changed in the document and in each delta. */
function ProposalRevisionWrapped() {
  const { workspaceId, key, number } = useParams() as { workspaceId: string, key: string, number: string }
  const service = useService(ProposalRevisionService)
  const revision = useValue(service.revision)
  const documentDiff = useValue(service.documentDiff)
  const deltas = useValue(service.deltas.items)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, key, Number(number))
  }, [service, workspaceId, key, number])

  if (revision === undefined) return <Spinner label="Loading the revision" />
  if (revision === null) return <NotFound />

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <TextLink href={`/w/${workspaceId}/proposals/${key}`}>{key}</TextLink>
        <PageHeader
          title={`Revision ${revision.number}: ${revision.message}`}
          description={`Published by @${revision.publishedBy.nick} on ${new Date(revision.publishedAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}`}
        />
      </Stack>
      <Card title="Document" titleLevel={2} description={revision.number === 1 ? 'As it was first published.' : `Against revision ${revision.number - 1}.`}>
        {revision.documentChanged
          ? <TextDiff parts={documentDiff} label={`Changes to the document in revision ${revision.number}`} />
          : <Text size="sm" tone="muted">The document did not change.</Text>}
      </Card>
      <Stack gap={4}>
        <Text weight="semibold">Deltas</Text>
        {deltas.map(snapshot => <ProposalRevisionDelta key={snapshot.id} snapshot={snapshot} />)}
        {hasMore && <Inline><Button size="sm" variant="outline" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></Inline>}
      </Stack>
    </Stack>
  )
}

/** What the revision did to one delta: added it, changed it (and how), kept it or removed it. */
function ProposalRevisionDelta({ snapshot }: { snapshot: DeltaSnapshotDTO }) {
  const service = useService(ProposalRevisionService)
  const dimensions = useValue(service.dimensions)
  useValue(service.names)
  const said = snapshot.content ?? snapshot.previous
  const label = said?.targetLabel ?? ''
  const caption = `${OPERATION_LABEL[snapshot.operation]} ${KIND_LABEL[snapshot.kind]} ${label}`

  return (
    <Card
      title={(
        <Inline gap={2} wrap>
          <Text weight="semibold">{`${OPERATION_LABEL[snapshot.operation]} ${KIND_LABEL[snapshot.kind]}`}</Text>
          {snapshot.kind === 'rule' ? <ArtifactTag kind="rule" id={label} /> : <Text tone="muted">{label}</Text>}
        </Inline>
      )}
      titleLevel={3}
      action={<Badge tone={CHANGE_TONE[snapshot.change]}>{snapshot.change}</Badge>}
    >
      {snapshot.change === 'added' && snapshot.content && (
        <DeltaChanges delta={{ kind: snapshot.kind, operation: snapshot.operation, ...snapshot.content }} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
      )}
      {snapshot.change === 'changed' && (
        <DeltaStateChanges kind={snapshot.kind} from={snapshot.previous?.after} to={snapshot.content?.after} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
      )}
      {snapshot.change === 'unchanged' && <Text size="sm" tone="muted">Unchanged: it keeps its verdicts.</Text>}
      {snapshot.change === 'removed' && <Text size="sm" tone="muted">It left the proposal in this revision.</Text>}
    </Card>
  )
}
