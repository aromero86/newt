import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ArrowDownIcon, ArrowUpIcon, MoreHorizontalIcon } from 'lucide-react'
import type { FeatureDTO } from '@newt/api/feature'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@newt/ui/components/table'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { DefinitionEditDialog } from '../definition-edit-dialog/definition-edit-dialog'
import { DefinitionAreaService } from './definition-area.service'

/** With its own DefinitionAreaService: whoever renders it needs nothing else. */
export function DefinitionArea() {
  return (
    <Provide services={[DefinitionAreaService]}>
      <DefinitionAreaWrapped />
    </Provide>
  )
}

/** One area and its features, in their order. */
function DefinitionAreaWrapped() {
  const { workspaceId, areaId } = useParams() as { workspaceId: string, areaId: string }
  const service = useService(DefinitionAreaService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const area = useValue(service.area)
  const editing = useValue(service.editing)
  const features = useValue(service.features.items)
  const total = useValue(service.features.total)
  const hasMore = useValue(service.features.hasMore)
  const loadingMore = useValue(service.features.loadingMore)
  const failure = useValue(service.features.failure)
  const showRetired = useValue(service.showRetired)
  const submitting = useValue(service.form.submitting)

  useEffect(() => {
    void service.load(workspaceId, areaId)
  }, [service, workspaceId, areaId])

  if (area === undefined) return <Spinner label="Loading the area" />
  if (area === null) return <NotFound />

  const retiredArea = area.retiredAt !== null
  const readOnly = Boolean(workspace?.archivedAt)
  const definition = `/w/${workspaceId}/definition`

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.create()
  }

  function actions(feature: FeatureDTO): MenuItem[] {
    return [
      { label: 'Move up', icon: ArrowUpIcon, disabled: feature.position === 0, onSelect: () => void service.move(feature, -1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: feature.position === total - 1, onSelect: () => void service.move(feature, 1) },
      { separator: true },
      { label: 'Retire', tone: 'destructive', onSelect: () => void service.retire(feature) },
    ]
  }

  const areaActions: MenuItem[] = retiredArea
    ? [{ label: 'Restore the area', onSelect: () => void service.restoreArea() }]
    : [
        { label: 'Edit', onSelect: () => service.openEdit() },
        { separator: true },
        { label: 'Retire the area', tone: 'destructive', disabled: area.activeFeatures > 0, onSelect: () => void service.retireArea() },
      ]

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <TextLink href={definition}>All areas</TextLink>
        <PageHeader
          title={area.name}
          description={area.description || undefined}
          actions={(
            <Inline gap={2}>
              {retiredArea && <Badge tone="muted">retired</Badge>}
              {!readOnly && (
                <Menu
                  label={`Actions for ${area.name}`}
                  align="end"
                  trigger={<Button variant="outline" size="icon" label={`Actions for ${area.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                  items={areaActions}
                />
              )}
            </Inline>
          )}
        />
      </Stack>
      {retiredArea && <Alert tone="info" title="This area is retired">Its features stay readable. Restore it to change them.</Alert>}
      {failure && <Alert tone="bad" title="Could not load the features">{failure}</Alert>}
      <Card title={`Features (${total})`} titleLevel={2}>
        <Stack gap={6}>
          {features.length === 0
            ? <Text size="sm" tone="muted">No features in this area.</Text>
            : (
                <Table caption={`Features of ${area.name}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      {!readOnly && !retiredArea && <TableHead align="end">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {features.map(feature => (
                      <TableRow key={feature.id}>
                        <TableCell>
                          <Stack gap={0}>
                            <TextLink href={`${definition}/features/${feature.id}`}>{feature.name}</TextLink>
                            {feature.description && <Text size="sm" tone="muted">{firstLine(feature.description)}</Text>}
                          </Stack>
                        </TableCell>
                        {!readOnly && !retiredArea && (
                          <TableCell align="end">
                            <Menu
                              label={`Actions for ${feature.name}`}
                              align="end"
                              trigger={<Button variant="ghost" size="icon-sm" label={`Actions for ${feature.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                              items={actions(feature)}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
          {hasMore && (
            <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.features.loadMore()}>
              Load more features
            </Button>
          )}
          {!readOnly && !retiredArea && (
            <form onSubmit={onSubmit} noValidate>
              <Stack gap={4}>
                <FormField form={service.form} name="name" label="New feature" description="Something that can be done in the product, such as Checkout or Pay with Bizum." />
                <FormField form={service.form} name="description" label="Description" description="What it covers, and what it does not." rows={3} />
                <Stack gap={0} align="start">
                  <Button type="submit" variant="secondary" loading={submitting}>Create feature</Button>
                </Stack>
              </Stack>
            </form>
          )}
        </Stack>
      </Card>
      <Stack gap={4} align="start">
        <Button variant="ghost" size="sm" onClick={() => void service.toggleRetired()}>
          {showRetired ? 'Hide retired features' : 'Show retired features'}
        </Button>
        {showRetired && <DefinitionAreaRetired readOnly={readOnly || retiredArea} />}
      </Stack>
      <DefinitionEditDialog
        form={service.editForm}
        open={editing}
        title={`Edit ${area.name}`}
        onClose={() => service.closeEdit()}
        onSubmit={() => void service.saveEdit()}
      />
    </Stack>
  )
}

/** The area's retired features: still readable, and back with a restore. */
function DefinitionAreaRetired({ readOnly }: { readOnly: boolean }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionAreaService)
  const features = useValue(service.retired.items)
  const loaded = useValue(service.retired.loaded)
  const hasMore = useValue(service.retired.hasMore)
  const loadingMore = useValue(service.retired.loadingMore)

  if (!loaded) return <Spinner label="Loading the retired features" />
  if (features.length === 0) return <Text size="sm" tone="muted">No retired features.</Text>

  return (
    <Stack gap={3}>
      <Table caption="Retired features">
        <TableHeader>
          <TableRow>
            <TableHead>Retired feature</TableHead>
            {!readOnly && <TableHead align="end">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {features.map(feature => (
            <TableRow key={feature.id}>
              <TableCell><TextLink href={`/w/${workspaceId}/definition/features/${feature.id}`}>{feature.name}</TextLink></TableCell>
              {!readOnly && (
                <TableCell align="end">
                  <Button variant="outline" size="sm" onClick={() => void service.restore(feature)}>Restore</Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore && (
        <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.retired.loadMore()}>
          Load more retired features
        </Button>
      )}
    </Stack>
  )
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]!
  return line.length > 140 ? `${line.slice(0, 140)}…` : line
}
