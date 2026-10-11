import { useEffect } from 'react'
import { useParams } from 'react-router'
import { CheckCircle2Icon } from 'lucide-react'
import type { ReleaseArtifactDTO, ReleaseChangeDTO } from '@newt/api/release'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxEmpty, BoxFooter, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Counter } from '@newt/ui/components/counter'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaStateChanges } from '../../../components/delta-changes'
import { KIND_LABEL } from '../../../components/delta-title'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { ReleaseChangesService } from './release-changes.service'
const TONE = { added: 'ok', changed: 'warn', retired: 'bad', restored: 'info' } as const

/** With its own ReleaseChangesService: whoever renders it needs nothing else. */
export function ReleaseChanges({ release, title }: { release: string | null, title: string }) {
  return (
    <Provide services={[ReleaseChangesService]}>
      <ReleaseChangesWrapped release={release} title={title} />
    </Provide>
  )
}

/** Each artifact that changed, how, and the proposals behind it: one row each, in a box. */
function ReleaseChangesWrapped({ release, title }: { release: string | null, title: string }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(ReleaseChangesService)
  const changes = useValue(service.changes.items)
  const total = useValue(service.changes.total)
  const loaded = useValue(service.changes.loaded)
  const failure = useValue(service.changes.failure)
  const hasMore = useValue(service.changes.hasMore)
  const loadingMore = useValue(service.changes.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, release)
  }, [service, workspaceId, release])

  return (
    <Box label={title}>
      <BoxHeader>{title}{loaded && <Counter>{total}</Counter>}</BoxHeader>
      {failure && <BoxBody><Alert tone="bad" title="Could not load the changes">{failure}</Alert></BoxBody>}
      {!loaded && !failure && <BoxEmpty title="Loading the changes" />}
      {loaded && changes.length === 0 && <BoxEmpty icon={CheckCircle2Icon} title={release ? 'Nothing changed' : 'Nothing changed since the last release'} />}
      {changes.map(change => <ReleaseChangeRow key={change.id} change={change} />)}
      {hasMore && <BoxFooter><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.changes.loadMore()}>Load more changes</Button></BoxFooter>}
    </Box>
  )
}

/** One change: what it is, before and after field by field, and its proposals. */
function ReleaseChangeRow({ change }: { change: ReleaseChangeDTO }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(ReleaseChangesService)
  const dimensions = useValue(service.dimensions)
  const names = namesOf(change)
  const caption = `${change.change} ${KIND_LABEL[change.kind]} ${change.label}`

  return (
    <BoxRow
      trailing={(
        <>
          {change.proposals.map(proposal => <TextLink key={proposal.key} href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.key}</TextLink>)}
          <Badge tone={TONE[change.change]}>{change.change}</Badge>
        </>
      )}
    >
      <Stack gap={3}>
        <Inline gap={2}>
          {change.kind === 'rule' ? <ArtifactTag kind="rule" id={change.label} /> : <><Badge tone="outline">{KIND_LABEL[change.kind]}</Badge><Text size="sm" weight="semibold" as="span">{change.label}</Text></>}
        </Inline>
        {(change.change === 'added' || change.change === 'changed') && (
          <DeltaStateChanges
            kind={change.kind}
            from={change.change === 'added' ? null : stateOf(change.before)}
            to={stateOf(change.after)}
            dimensions={dimensions}
            name={id => names[id] ?? 'Unknown'}
            caption={caption}
          />
        )}
        {change.change === 'retired' && <Text size="sm" tone="muted">It is no longer in the product.</Text>}
        {change.change === 'restored' && <Text size="sm" tone="muted">It is back in the product.</Text>}
      </Stack>
    </BoxRow>
  )
}

/** A pictured artifact as the state a delta leaves it in, which `DeltaStateChanges` compares. */
function stateOf(artifact: ReleaseArtifactDTO | null): unknown {
  if (!artifact) return null
  switch (artifact.kind) {
    case 'dimension': return { name: artifact.name, values: artifact.values }
    case 'feature-area': return { name: artifact.name, description: artifact.description }
    case 'feature': return { areaId: artifact.areaId, name: artifact.name, description: artifact.description }
    case 'rule': return { kind: artifact.ruleKind, statement: artifact.statement, why: artifact.why, scope: artifact.scope, criteria: artifact.criteria }
  }
}

/** The names of the area a feature lives in, by id, as the pictures say them. */
function namesOf(change: ReleaseChangeDTO): Record<string, string> {
  const names: Record<string, string> = {}
  for (const artifact of [change.before, change.after]) if (artifact?.kind === 'feature') names[artifact.areaId] = artifact.areaName
  return names
}
