import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import type { DeltaComparisonDTO } from '@newt/api/proposal'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxFooter, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Button } from '@newt/ui/components/button'
import { PageTitle } from '@newt/ui/components/page-title'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { TextDiff } from '@newt/ui/components/text-diff'
import { DeltaChanges, DeltaStateChanges } from '../../../components/delta-changes'
import { DeltaTitle, KIND_LABEL, OPERATION_LABEL } from '../../../components/delta-title'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'
import { ProposalCompareService } from './proposal-compare.service'
/** With its own services: whoever renders it needs nothing else. */
export function ProposalCompare() {
  return (
    <Provide services={[ArtifactNamesService, ProposalCompareService]}>
      <ProposalCompareWrapped />
    </Provide>
  )
}

/** Two revisions, `?from=` and `?to=`: how the document and each delta differ between them. */
function ProposalCompareWrapped() {
  const { workspaceId, key } = useParams() as { workspaceId: string, key: string }
  const [params] = useSearchParams()
  const from = Number(params.get('from') ?? 1)
  const to = Number(params.get('to') ?? 1)
  const service = useService(ProposalCompareService)
  const loaded = useValue(service.loaded)
  const documentDiff = useValue(service.documentDiff)
  const deltas = useValue(service.deltas.items)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, key, from, to)
  }, [service, workspaceId, key, from, to])

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Breadcrumbs items={[{ label: 'Proposals', href: `/w/${workspaceId}/proposals` }, { label: key, href: `/w/${workspaceId}/proposals/${key}` }, { label: 'Compare' }]} />
        <PageTitle>{`Revision ${from} → revision ${to}`}</PageTitle>
        <Text size="sm" tone="muted">What changed between them, in the document and in each delta.</Text>
      </Stack>
      {!loaded && <Spinner label="Comparing the revisions" />}
      {loaded && (
        <Box label="Document">
          <BoxHeader>Document</BoxHeader>
          <BoxBody>
            {documentDiff.some(part => part.added || part.removed)
              ? <TextDiff parts={documentDiff} label={`Changes to the document from revision ${from} to ${to}`} />
              : <Text size="sm" tone="muted">The document is the same.</Text>}
          </BoxBody>
        </Box>
      )}
      {loaded && (
        <Box label="Deltas">
          <BoxHeader>Deltas</BoxHeader>
          {deltas.map(comparison => <ProposalCompareDelta key={comparison.id} comparison={comparison} from={from} to={to} />)}
          {hasMore && <BoxFooter><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></BoxFooter>}
        </Box>
      )}
    </Stack>
  )
}

/** One delta in both revisions: only in one, the same, or how it changed. */
function ProposalCompareDelta({ comparison, from, to }: { comparison: DeltaComparisonDTO, from: number, to: number }) {
  const service = useService(ProposalCompareService)
  const dimensions = useValue(service.dimensions)
  useValue(service.names)
  const label = (comparison.to ?? comparison.from)?.targetLabel ?? ''
  const caption = `${OPERATION_LABEL[comparison.operation]} ${KIND_LABEL[comparison.kind]} ${label}`
  const same = comparison.from && comparison.to && JSON.stringify(comparison.from.after) === JSON.stringify(comparison.to.after)
  const badge = !comparison.from ? { tone: 'ok' as const, text: `not in revision ${from}` } : !comparison.to ? { tone: 'bad' as const, text: `not in revision ${to}` } : same ? { tone: 'muted' as const, text: 'same' } : { tone: 'warn' as const, text: 'changed' }

  return (
    <BoxRow trailing={<Badge tone={badge.tone}>{badge.text}</Badge>}>
      <Stack gap={3}>
        <DeltaTitle delta={{ kind: comparison.kind, operation: comparison.operation, targetLabel: label }} />
        {!comparison.from && comparison.to && (
          <DeltaChanges delta={{ kind: comparison.kind, operation: comparison.operation, ...comparison.to }} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
        )}
        {comparison.from && comparison.to && !same && (
          <DeltaStateChanges kind={comparison.kind} from={comparison.from.after} to={comparison.to.after} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
        )}
        {same && <Text size="sm" tone="muted">The same in both.</Text>}
        {comparison.from && !comparison.to && <Text size="sm" tone="muted">{`It left the proposal before revision ${to}.`}</Text>}
      </Stack>
    </BoxRow>
  )
}
