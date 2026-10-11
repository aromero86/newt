import type { FormEvent } from 'react'
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import type { DimensionDTO, DimensionValueDTO } from '@newt/api/dimension'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../../components/form-field'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { useOpenProposal } from '../../../../services/quick-proposal/use-open-proposal'
import { DefinitionHistory } from '../../definition-history/definition-history'
import { DefinitionDimensionsRenameService } from '../definition-dimensions-rename/definition-dimensions-rename.service'
import { DefinitionDimensionsService } from '../definition-dimensions.service'
import { DefinitionDimensionsItemService } from './definition-dimensions-item.service'

type DefinitionDimensionsItemProps = {
  dimension: DimensionDTO
  first: boolean
  last: boolean
  /** An archived workspace only shows its dimensions. */
  readOnly: boolean
}

/** With its own DefinitionDimensionsItemService: whoever renders it needs nothing else. */
export function DefinitionDimensionsItem(props: DefinitionDimensionsItemProps) {
  return (
    <Provide services={[DefinitionDimensionsItemService]}>
      <DefinitionDimensionsItemWrapped {...props} />
    </Provide>
  )
}

/** One dimension: its values, in order, and the retired ones after them. */
function DefinitionDimensionsItemWrapped({ dimension, first, last, readOnly }: DefinitionDimensionsItemProps) {
  const dimensions = useService(DefinitionDimensionsService)
  const rename = useService(DefinitionDimensionsRenameService)
  const item = useService(DefinitionDimensionsItemService)
  const open = useOpenProposal()

  // Active values in their order; retired ones stay listed after them.
  const active = dimension.values.filter(value => !value.retiredAt)
  const values = [...active, ...dimension.values.filter(value => value.retiredAt)]

  const dimensionActions: MenuItem[] = [
    { label: 'Propose a value', icon: PlusIcon, onSelect: () => item.openAdd() },
    { label: 'Propose renaming', onSelect: () => rename.open({ dimension }) },
    { separator: true },
    { label: 'Move up', icon: ArrowUpIcon, disabled: first, onSelect: () => void dimensions.move(dimension, -1) },
    { label: 'Move down', icon: ArrowDownIcon, disabled: last, onSelect: () => void dimensions.move(dimension, 1) },
  ]

  function valueActions(value: DimensionValueDTO): MenuItem[] {
    if (value.retiredAt) return [{ label: 'Propose restoring', onSelect: () => void open(dimensions.proposeRestoring(dimension, value)) }]
    const index = active.indexOf(value)
    return [
      { label: 'Propose renaming', onSelect: () => rename.open({ dimension, value }) },
      { separator: true },
      { label: 'Move up', icon: ArrowUpIcon, disabled: index === 0, onSelect: () => void dimensions.moveValue(dimension, value, -1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: index === active.length - 1, onSelect: () => void dimensions.moveValue(dimension, value, 1) },
      { separator: true },
      { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(dimensions.proposeRetiring(dimension, value)) },
    ]
  }

  const menu = (label: string, items: MenuItem[]) => (
    <Menu label={label} align="end" trigger={<Button variant="ghost" size="icon-sm" label={label}><Icon icon={MoreHorizontalIcon} /></Button>} items={items} />
  )

  return (
    <Box label={dimension.name}>
      <BoxHeader actions={!readOnly && menu(`Actions for ${dimension.name}`, dimensionActions)}>
        {dimension.name}
        <Text size="sm" tone="muted" as="span">{active.length === 1 ? '1 value' : `${active.length} values`}</Text>
      </BoxHeader>
      {values.length === 0 && <BoxEmpty title="No values yet" action={!readOnly ? <Button size="sm" variant="outline" onClick={() => item.openAdd()}>Propose a value</Button> : undefined} />}
      {values.map(value => (
        <BoxRow key={value.id} trailing={!readOnly && menu(`Actions for ${value.name}`, valueActions(value))}>
          <Inline gap={2}>
            <Text size="sm" tone={value.retiredAt ? 'muted' : 'default'} as="span">{value.name}</Text>
            {value.retiredAt && <Badge tone="muted">retired</Badge>}
          </Inline>
        </BoxRow>
      ))}
      <DefinitionHistory targetId={dimension.id} boxed />
      <DefinitionDimensionsItemAdd dimension={dimension} />
    </Box>
  )
}

/** Proposing a new value for the dimension, in a quick proposal. */
function DefinitionDimensionsItemAdd({ dimension }: { dimension: DimensionDTO }) {
  const item = useService(DefinitionDimensionsItemService)
  const adding = useValue(item.adding)
  const submitting = useValue(item.form.submitting)
  const open = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(item.addValue(dimension))
  }

  return (
    <Dialog open={adding} onOpenChange={next => !next && item.closeAdd()} title={`New value for ${dimension.name}`} description="It goes in a quick proposal, to approve." size="sm">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={item.form} name="name" label="Name" />
          <Inline justify="end"><Button type="submit" loading={submitting}>Propose</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
