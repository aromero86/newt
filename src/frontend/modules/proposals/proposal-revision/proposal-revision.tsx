import { useEffect } from 'react'
import { useParams } from 'react-router'
import type { DeltaSnapshotDTO } from '@newt/api/proposal'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxFooter, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Button } from '@newt/ui/components/button'
import { PageTitle } from '@newt/ui/components/page-title'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { TextDiff } from '@newt/ui/components/text-diff'
import { DeltaChanges, DeltaStateChanges } from '../../../components/delta-changes'
import { DeltaTitle, KIND_LABEL, OPERATION_LABEL } from '../../../components/delta-title'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'
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
    <Stack gap={6}>
      <Stack gap={2}>
        <Breadcrumbs items={[{ label: 'Proposals', href: `/w/${workspaceId}/proposals` }, { label: key, href: `/w/${workspaceId}/proposals/${key}` }, { label: `Revision ${revision.number}` }]} />
        <PageTitle reference={`r${revision.number}`}>{revision.message}</PageTitle>
        <Text size="sm" tone="muted">
          {`@${revision.publishedBy.nick} published it `}<RelativeTime date={revision.publishedAt} />{revision.assistant ? `, written with ${revision.assistant}` : ''}
        </Text>
      </Stack>
      <Box label="Document">
        <BoxHeader>{revision.number === 1 ? 'Document, as first published' : `Document, against revision ${revision.number - 1}`}</BoxHeader>
        <BoxBody>
          {revision.documentChanged
            ? <TextDiff parts={documentDiff} label={`Changes to the document in revision ${revision.number}`} />
            : <Text size="sm" tone="muted">The document did not change.</Text>}
        </BoxBody>
      </Box>
      <Box label="Deltas">
        <BoxHeader>What it did to the deltas</BoxHeader>
        {revision.extraction === 'extracting' && <BoxBody><Text size="sm" tone="muted">Its deltas are still being extracted from the document.</Text></BoxBody>}
        {revision.extraction === 'failed' && <BoxBody><Text size="sm" tone="muted">{`Its deltas could not be extracted from the document: ${revision.extractionError ?? 'something went wrong'}.`}</Text></BoxBody>}
        {deltas.map(snapshot => <ProposalRevisionDelta key={snapshot.id} snapshot={snapshot} />)}
        {hasMore && <BoxFooter><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></BoxFooter>}
      </Box>
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
    <BoxRow trailing={<Badge tone={CHANGE_TONE[snapshot.change]}>{snapshot.change}</Badge>}>
      <Stack gap={3}>
        <DeltaTitle delta={{ kind: snapshot.kind, operation: snapshot.operation, targetLabel: label }} />
        {snapshot.change === 'added' && snapshot.content && (
          <DeltaChanges delta={{ kind: snapshot.kind, operation: snapshot.operation, ...snapshot.content }} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
        )}
        {snapshot.change === 'changed' && (
          <DeltaStateChanges kind={snapshot.kind} from={snapshot.previous?.after} to={snapshot.content?.after} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
        )}
        {snapshot.change === 'unchanged' && <Text size="sm" tone="muted">Unchanged: it keeps its verdicts.</Text>}
        {snapshot.change === 'removed' && <Text size="sm" tone="muted">It left the proposal in this revision.</Text>}
      </Stack>
    </BoxRow>
  )
}
