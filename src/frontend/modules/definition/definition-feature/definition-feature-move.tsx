import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Field } from '@newt/ui/components/field'
import { Select } from '@newt/ui/components/select'
import { Stack } from '@newt/ui/components/stack'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { DefinitionFeatureService } from './definition-feature.service'

/** Proposes another active area for the feature; it lands at the end. */
export function DefinitionFeatureMove() {
  const service = useService(DefinitionFeatureService)
  const feature = useValue(service.feature)
  const moving = useValue(service.moving)
  const target = useValue(service.target)
  const areas = useValue(service.areas.items)
  const hasMore = useValue(service.areas.hasMore)
  const loadingMore = useValue(service.areas.loadingMore)
  const open = useOpenProposal()

  const options = areas.filter(area => area.id !== feature?.areaId).map(area => ({ value: area.id, label: area.name }))

  return (
    <Dialog
      open={moving}
      onOpenChange={open => !open && service.closeMove()}
      title={`Propose moving ${feature?.name ?? ''}`}
      description="It goes to the end of the area you pick, once the quick proposal is merged."
      size="sm"
    >
      <Stack gap={4} align="start">
        <Field label="Area">
          <Select options={options} value={target} onValueChange={value => service.pick(value)} placeholder="Pick an area" />
        </Field>
        {hasMore && (
          <Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.areas.loadMore()}>
            Load more areas
          </Button>
        )}
        <Button disabled={!target} onClick={() => void open(service.move())}>Propose</Button>
      </Stack>
    </Dialog>
  )
}
