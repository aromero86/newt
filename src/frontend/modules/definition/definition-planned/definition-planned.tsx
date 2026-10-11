import { useEffect } from 'react'
import { useParams } from 'react-router'
import { CalendarClockIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { TextLink } from '@newt/ui/components/link'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { Text } from '@newt/ui/components/text'
import { DeltaChanges } from '../../../components/delta-changes'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'
import { DeltaTitle, KIND_LABEL, OPERATION_LABEL } from '../../../components/delta-title'
import { DefinitionPlannedService } from './definition-planned.service'

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
    <Stack gap={4}>
      <Subhead title="Planned" description="The definition in force is what is merged. These changes are accepted too, and enter it once their code is in." />
      {failure && <Alert tone="bad" title="Could not load the planned changes">{failure}</Alert>}
      <Box label="Planned changes">
        <BoxHeader>{`${total} ${total === 1 ? 'change' : 'changes'} planned`}</BoxHeader>
        {loaded && planned.length === 0 && (
          <BoxEmpty icon={CalendarClockIcon} title="Nothing planned" description="No accepted proposal is waiting for its code: the planned definition is the one in force." />
        )}
        {planned.map(({ proposal, delta }) => (
          <BoxRow key={delta.id} trailing={<TextLink href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.key}</TextLink>}>
            <Stack gap={3}>
              <Stack gap={1}>
                <DeltaTitle delta={delta} />
                <Text size="sm" tone="muted">{proposal.title}</Text>
              </Stack>
              <DeltaChanges delta={delta} dimensions={dimensions} name={id => service.name(id)} caption={`${OPERATION_LABEL[delta.operation]} ${KIND_LABEL[delta.kind]} ${delta.targetLabel}`} />
            </Stack>
          </BoxRow>
        ))}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.planned.loadMore()}>Load more changes</Button></BoxFooter>}
      </Box>
    </Stack>
  )
}
