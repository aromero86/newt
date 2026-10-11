import type { FormEvent } from 'react'
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon } from 'lucide-react'
import type { DimensionDTO, DimensionValueDTO } from '@newt/api/dimension'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { Stack } from '@newt/ui/components/stack'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@newt/ui/components/table'
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
  const submitting = useValue(item.form.submitting)
  const open = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(item.addValue(dimension))
  }

  const dimensionActions: MenuItem[] = [
    { label: 'Propose renaming', onSelect: () => rename.open({ dimension }) },
    { separator: true },
    { label: 'Move up', icon: ArrowUpIcon, disabled: first, onSelect: () => void dimensions.move(dimension, -1) },
    { label: 'Move down', icon: ArrowDownIcon, disabled: last, onSelect: () => void dimensions.move(dimension, 1) },
  ]

  // Active values in their order; retired ones stay listed after them.
  const active = dimension.values.filter(value => !value.retiredAt)
  const values = [...active, ...dimension.values.filter(value => value.retiredAt)]

  function valueActions(value: DimensionValueDTO): MenuItem[] {
    const index = active.indexOf(value)
    if (value.retiredAt) return [{ label: 'Propose restoring', onSelect: () => void open(dimensions.proposeRestoring(dimension, value)) }]
    return [
      { label: 'Propose renaming', onSelect: () => rename.open({ dimension, value }) },
      { separator: true },
      { label: 'Move up', icon: ArrowUpIcon, disabled: index === 0, onSelect: () => void dimensions.moveValue(dimension, value, -1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: index === active.length - 1, onSelect: () => void dimensions.moveValue(dimension, value, 1) },
      { separator: true },
      { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(dimensions.proposeRetiring(dimension, value)) },
    ]
  }

  const actions = (label: string, items: MenuItem[]) => (
    <Menu
      label={label}
      align="end"
      trigger={<Button variant="ghost" size="icon-sm" label={label}><Icon icon={MoreHorizontalIcon} /></Button>}
      items={items}
    />
  )

  return (
    <Card
      title={dimension.name}
      titleLevel={3}
      description={active.length === 1 ? '1 value' : `${active.length} values`}
      action={readOnly ? undefined : actions(`Actions for ${dimension.name}`, dimensionActions)}
    >
      <Stack gap={4}>
        {values.length === 0
          ? <Text size="sm" tone="muted">No values yet.</Text>
          : (
              <Table caption={`Values of ${dimension.name}`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Value</TableHead>
                    {!readOnly && <TableHead align="end">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {values.map(value => (
                    <TableRow key={value.id}>
                      <TableCell>
                        <Inline gap={2}>
                          <Text size="sm" tone={value.retiredAt ? 'muted' : 'default'}>{value.name}</Text>
                          {value.retiredAt && <Badge tone="muted">retired</Badge>}
                        </Inline>
                      </TableCell>
                      {!readOnly && (
                        <TableCell align="end">
                          {actions(`Actions for ${value.name}`, valueActions(value))}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        {!readOnly && (
          <form onSubmit={onSubmit} noValidate>
            <Stack gap={3} align="start">
              <FormField form={item.form} name="name" label="Propose a value" />
              <Button type="submit" variant="secondary" loading={submitting}>Propose</Button>
            </Stack>
          </form>
        )}
        <DefinitionHistory targetId={dimension.id} />
      </Stack>
    </Card>
  )
}
