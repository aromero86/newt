import { useEffect, type FormEvent } from 'react'
import { DimensionLimits } from '@newt/api/dimension'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { DefinitionDimensionsItem } from './definition-dimensions-item/definition-dimensions-item'
import { DefinitionDimensionsRename } from './definition-dimensions-rename/definition-dimensions-rename'
import { DefinitionDimensionsRenameService } from './definition-dimensions-rename/definition-dimensions-rename.service'
import { DefinitionDimensionsService } from './definition-dimensions.service'

type DefinitionDimensionsProps = {
  workspaceId: string
  /** An archived workspace only shows its dimensions. */
  readOnly: boolean
}

/** With its own services: whoever renders it needs nothing else. */
export function DefinitionDimensions(props: DefinitionDimensionsProps) {
  return (
    <Provide services={[DefinitionDimensionsService, DefinitionDimensionsRenameService]}>
      <DefinitionDimensionsWrapped {...props} />
    </Provide>
  )
}

/** The axes that say where each part of the product applies: platform, market, plan… */
function DefinitionDimensionsWrapped({ workspaceId, readOnly }: DefinitionDimensionsProps) {
  const service = useService(DefinitionDimensionsService)
  const dimensions = useValue(service.dimensions)
  const loaded = useValue(service.loaded)
  const submitting = useValue(service.form.submitting)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.create()
  }

  if (!loaded) return <Spinner label="Loading the dimensions" />

  return (
    <Stack gap={6}>
      <Card
        title={`Dimensions (${dimensions.length})`}
        titleLevel={2}
        description={`Where each part of the product applies: platform, market, plan… Up to ${DimensionLimits.dimensions}, with up to ${DimensionLimits.values} values each.`}
      >
        {readOnly
          ? <Text size="sm" tone="muted">The workspace is archived: its dimensions are read only.</Text>
          : (
              <form onSubmit={onSubmit} noValidate>
                <Stack gap={3} align="start">
                  <FormField form={service.form} name="name" label="New dimension" description="For example: Platform, Market or Plan." />
                  <Button type="submit" variant="secondary" loading={submitting}>Create</Button>
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
