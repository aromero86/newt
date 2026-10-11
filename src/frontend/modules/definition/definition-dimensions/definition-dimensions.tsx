import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { PlusIcon, RulerIcon } from 'lucide-react'
import { DimensionLimits } from '@newt/api/dimension'
import { Box, BoxEmpty } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
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

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  if (!loaded) return <Spinner label="Loading the dimensions" />

  return (
    <Stack gap={4}>
      <Subhead
        title="Dimensions"
        description={`Where each part of the product applies: platform, market, plan… Up to ${DimensionLimits.dimensions}, with up to ${DimensionLimits.values} values each.`}
        actions={!readOnly && <Button size="sm" onClick={() => service.openCreate()}><Icon icon={PlusIcon} size="sm" />New dimension</Button>}
      />
      <DefinitionPlannedNotice targetIds={dimensions.map(dimension => dimension.id)} />
      {dimensions.length === 0 && (
        <Box label="Dimensions">
          <BoxEmpty icon={RulerIcon} title="No dimensions yet" description="Without them, every rule applies everywhere. Add one when the product starts to differ by platform, market or plan." />
        </Box>
      )}
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
      <DefinitionDimensionsCreate />
    </Stack>
  )
}

/** Proposing a new dimension, in a quick proposal. */
function DefinitionDimensionsCreate() {
  const service = useService(DefinitionDimensionsService)
  const creating = useValue(service.creating)
  const submitting = useValue(service.form.submitting)
  const open = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(service.create())
  }

  return (
    <Dialog open={creating} onOpenChange={next => !next && service.closeCreate()} title="New dimension" description="It goes in a quick proposal, to approve. Its values come after." size="sm">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.form} name="name" label="Name" description="For example: Platform, Market or Plan." />
          <Inline justify="end"><Button type="submit" loading={submitting}>Propose</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
