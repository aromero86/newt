import { useEffect } from 'react'
import { useParams } from 'react-router'
import type { ReleaseArtifactDTO, ReleaseChangeDTO } from '@newt/api/release'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaStateChanges } from '../../../components/delta-changes'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { ReleaseChangesService } from './release-changes.service'

const KIND = { 'dimension': 'dimension', 'feature-area': 'area', 'feature': 'feature', 'rule': 'rule' } as const
const TONE = { added: 'ok', changed: 'warn', retired: 'bad', restored: 'info' } as const

/** With its own ReleaseChangesService: whoever renders it needs nothing else. */
export function ReleaseChanges({ release }: { release: string | null }) {
  return (
    <Provide services={[ReleaseChangesService]}>
      <ReleaseChangesWrapped release={release} />
    </Provide>
  )
}

/** Each artifact that changed, how, and the proposals behind it. */
function ReleaseChangesWrapped({ release }: { release: string | null }) {
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

  if (failure) return <Alert tone="bad" title="Could not load the changes">{failure}</Alert>
  if (!loaded) return <Spinner label="Loading the changes" />
  if (changes.length === 0) return <Text size="sm" tone="muted">{release ? 'Nothing changed.' : 'Nothing changed since the last release.'}</Text>

  return (
    <Stack gap={4}>
      <Text size="sm" tone="muted">{`${total} ${total === 1 ? 'artifact' : 'artifacts'} changed`}</Text>
      {changes.map(change => <ReleaseChangeCard key={change.id} change={change} />)}
      {hasMore && <Inline><Button size="sm" variant="outline" loading={loadingMore} onClick={() => void service.changes.loadMore()}>Load more changes</Button></Inline>}
    </Stack>
  )
}

/** One change: before and after, field by field, and its proposals. */
function ReleaseChangeCard({ change }: { change: ReleaseChangeDTO }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(ReleaseChangesService)
  const dimensions = useValue(service.dimensions)
  const names = namesOf(change)
  const caption = `${change.change} ${KIND[change.kind]} ${change.label}`

  return (
    <Card
      title={(
        <Inline gap={2} wrap>
          <Text weight="semibold">{KIND[change.kind]}</Text>
          {change.kind === 'rule' ? <ArtifactTag kind="rule" id={change.label} /> : <Text tone="muted">{change.label}</Text>}
        </Inline>
      )}
      titleLevel={3}
      action={<Badge tone={TONE[change.change]}>{change.change}</Badge>}
    >
      <Stack gap={3}>
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
        {change.proposals.length > 0 && (
          <Inline gap={2} wrap>
            <Text size="sm" tone="muted">By</Text>
            {change.proposals.map(proposal => (
              <Inline key={proposal.key} gap={1}>
                <TextLink href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.key}</TextLink>
                <Text size="sm" tone="muted">{proposal.title}</Text>
              </Inline>
            ))}
          </Inline>
        )}
      </Stack>
    </Card>
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
