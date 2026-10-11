import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { DimensionLimits } from '@newt/api/dimension'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { DefinitionPlannedNotice } from '../definition-planned-notice/definition-planned-notice'
import { DefinitionDimensionsItem } from './definition-dimensions-item/definition-dimensions-item'
import { DefinitionDimensionsRename } from './definition-dimensions-rename/definition-dimensions-rename'
import { DefinitionDimensionsRenameService } from './definition-dimensions-rename/definition-dimensions-rename.service'
import { DefinitionDimensionsService } from './definition-dimensions.service'

/** With its own services: whoever renders it needs nothing else. */
export function DefinitionDimensions() {
  return (
    <Provide services={[DefinitionDimensionsService, DefinitionDimensionsRenameService]}>
      <DefinitionDimensionsWrapped />
    </Provide>
  )
}

/** The axes that say where each part of the product applies: platform, market, plan… */
function DefinitionDimensionsWrapped() {
  const workspaceId = useParams().workspaceId!
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const readOnly = Boolean(workspace?.archivedAt)
  const service = useService(DefinitionDimensionsService)
  const dimensions = useValue(service.dimensions)
  const loaded = useValue(service.loaded)
  const submitting = useValue(service.form.submitting)
  const open = useOpenProposal()

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(service.create())
  }

  if (!loaded) return <Spinner label="Loading the dimensions" />

  return (
    <Stack gap={6}>
      <PageHeader title="Dimensions" description="Where each part of the product applies: platform, market, plan…" />
      <DefinitionPlannedNotice targetIds={dimensions.map(dimension => dimension.id)} />
      <Card
        title={`Dimensions (${dimensions.length})`}
        titleLevel={2}
        description={`Up to ${DimensionLimits.dimensions}, with up to ${DimensionLimits.values} values each.`}
      >
        {readOnly
          ? <Text size="sm" tone="muted">The workspace is archived: its dimensions are read only.</Text>
          : (
              <form onSubmit={onSubmit} noValidate>
                <Stack gap={3} align="start">
                  <FormField form={service.form} name="name" label="Propose a dimension" description="For example: Platform, Market or Plan. It goes in a quick proposal, to approve." />
                  <Button type="submit" variant="secondary" loading={submitting}>Propose</Button>
                </Stack>
              </form>
            )}
      </Card>
      {dimensions.map((dimension, index) => (
        <DefinitionDimensionsItem
          key={dimension.id}
          dimension={dimension}
          first={index === 0}
          last={index === dimensions.length - 1}
          readOnly={readOnly}
        />
      ))}
      <DefinitionDimensionsRename />
    </Stack>
  )
}
