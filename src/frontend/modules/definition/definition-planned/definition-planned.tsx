import { useEffect } from 'react'
import { useParams } from 'react-router'
import { CalendarClockIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { EmptyState } from '@newt/ui/components/empty-state'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { DeltaChanges } from '../../../components/delta-changes'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'
import { DefinitionPlannedService } from './definition-planned.service'

const KIND = { 'dimension': 'dimension', 'feature-area': 'area', 'feature': 'feature', 'rule': 'rule' } as const
const OPERATION = { create: 'Create', change: 'Change', retire: 'Retire', restore: 'Restore' } as const

/** With its own services: whoever renders it needs nothing else. */
export function DefinitionPlanned() {
  return (
    <Provide services={[ArtifactNamesService, DefinitionPlannedService]}>
      <DefinitionPlannedWrapped />
    </Provide>
  )
}

/** What the definition will be: the one in force, plus the accepted changes still waiting for their code. */
function DefinitionPlannedWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionPlannedService)
  const dimensions = useValue(service.dimensions)
  useValue(service.names)
  const planned = useValue(service.planned.items)
  const total = useValue(service.planned.total)
  const loaded = useValue(service.planned.loaded)
  const failure = useValue(service.planned.failure)
  const hasMore = useValue(service.planned.hasMore)
  const loadingMore = useValue(service.planned.loadingMore)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  return (
    <Stack gap={8}>
      <PageHeader
        title="Planned"
        description="The definition in force is what is merged. These changes are accepted too, and enter it once their code is in."
      />
      {failure && <Alert tone="bad" title="Could not load the planned changes">{failure}</Alert>}
      {!loaded && !failure && <Spinner label="Loading the planned changes" />}
      {loaded && planned.length === 0 && (
        <EmptyState icon={CalendarClockIcon} title="Nothing planned" description="No accepted proposal is waiting for its code: the planned definition is the one in force." />
      )}
      {planned.length > 0 && <Text weight="semibold">{`${total} ${total === 1 ? 'change' : 'changes'} planned`}</Text>}
      {planned.map(({ proposal, delta }) => (
        <Card
          key={delta.id}
          title={`${OPERATION[delta.operation]} ${KIND[delta.kind]} ${delta.targetLabel}`}
          titleLevel={2}
          description={<Inline gap={1}><TextLink href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.key}</TextLink><Text size="sm" tone="muted">{proposal.title}</Text></Inline>}
        >
          <DeltaChanges delta={delta} dimensions={dimensions} name={id => service.name(id)} caption={`${OPERATION[delta.operation]} ${KIND[delta.kind]} ${delta.targetLabel}`} />
        </Card>
      ))}
      {hasMore && (
        <Inline>
          <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.planned.loadMore()}>Load more changes</Button>
        </Inline>
      )}
    </Stack>
  )
}
