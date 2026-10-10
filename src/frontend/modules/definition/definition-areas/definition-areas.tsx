import { useEffect, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowDownIcon, ArrowUpIcon, FolderTreeIcon, MoreHorizontalIcon } from 'lucide-react'
import type { FeatureAreaDTO } from '@newt/api/feature-area'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { EmptyState } from '@newt/ui/components/empty-state'
import { Grid } from '@newt/ui/components/grid'
import { Icon } from '@newt/ui/components/icon'
import { TextLink } from '@newt/ui/components/link'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { DefinitionAreasService } from './definition-areas.service'

/** With its own DefinitionAreasService: whoever renders it needs nothing else. */
export function DefinitionAreas() {
  return (
    <Provide services={[DefinitionAreasService]}>
      <DefinitionAreasWrapped />
    </Provide>
  )
}

/** The feature tree's first level: the areas, each with how many active features it has. */
function DefinitionAreasWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionAreasService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const areas = useValue(service.active.items)
  const total = useValue(service.active.total)
  const loaded = useValue(service.active.loaded)
  const failure = useValue(service.active.failure)
  const hasMore = useValue(service.active.hasMore)
  const loadingMore = useValue(service.active.loadingMore)
  const showRetired = useValue(service.showRetired)
  const submitting = useValue(service.form.submitting)
  const navigate = useNavigate()
  const readOnly = Boolean(workspace?.archivedAt)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const created = await service.create()
    if (created) navigate(`/w/${workspaceId}/definition/areas/${created.id}`)
  }

  function actions(area: FeatureAreaDTO): MenuItem[] {
    return [
      { label: 'Move up', icon: ArrowUpIcon, disabled: area.position === 0, onSelect: () => void service.move(area, -1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: area.position === total - 1, onSelect: () => void service.move(area, 1) },
      { separator: true },
      { label: 'Retire', tone: 'destructive', disabled: area.activeFeatures > 0, onSelect: () => void service.retire(area) },
    ]
  }

  return (
    <Stack gap={8}>
      <PageHeader title="Definition" description="What your product does today, area by area and feature by feature." />
      {failure && <Alert tone="bad" title="Could not load the areas">{failure}</Alert>}
      {!loaded && !failure && <Spinner label="Loading the areas" />}
      {loaded && areas.length === 0 && (
        <EmptyState icon={FolderTreeIcon} title="No areas yet" description="Group your features by part of the product: Checkout, Account, Backoffice…" />
      )}
      {areas.length > 0 && (
        <Grid columns={{ base: 1, md: 2, lg: 3 }} gap={4}>
          {areas.map(area => (
            <Card
              key={area.id}
              title={area.name}
              description={area.description || undefined}
              action={readOnly ? undefined : (
                <Menu
                  label={`Actions for ${area.name}`}
                  align="end"
                  trigger={<Button variant="ghost" size="icon-sm" label={`Actions for ${area.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                  items={actions(area)}
                />
              )}
              footer={<TextLink href={`/w/${workspaceId}/definition/areas/${area.id}`}>Open {area.name}</TextLink>}
            >
              <Text size="sm" tone="muted">{area.activeFeatures === 1 ? '1 feature' : `${area.activeFeatures} features`}</Text>
            </Card>
          ))}
        </Grid>
      )}
      {hasMore && (
        <Button variant="outline" loading={loadingMore} onClick={() => void service.active.loadMore()}>
          Load more areas
        </Button>
      )}
      {!readOnly && loaded && (
        <Card title="New area" titleLevel={2} description="A part of the product, such as Checkout, Account or Backoffice. Where things apply is said by dimensions.">
          <form onSubmit={event => void onSubmit(event)} noValidate>
            <Stack gap={4}>
              <FormField form={service.form} name="name" label="Name" />
              <FormField form={service.form} name="description" label="Description" description="What it covers, and what it does not." rows={3} />
              <Stack gap={0} align="start">
                <Button type="submit" variant="secondary" loading={submitting}>Create area</Button>
              </Stack>
            </Stack>
          </form>
        </Card>
      )}
      {loaded && (
        <Stack gap={4} align="start">
          <Button variant="ghost" size="sm" onClick={() => void service.toggleRetired()}>
            {showRetired ? 'Hide retired areas' : 'Show retired areas'}
          </Button>
          {showRetired && <DefinitionAreasRetired readOnly={readOnly} />}
        </Stack>
      )}
    </Stack>
  )
}

/** Retired areas: still readable, and back with a restore. */
function DefinitionAreasRetired({ readOnly }: { readOnly: boolean }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionAreasService)
  const areas = useValue(service.retired.items)
  const loaded = useValue(service.retired.loaded)
  const hasMore = useValue(service.retired.hasMore)
  const loadingMore = useValue(service.retired.loadingMore)

  if (!loaded) return <Spinner label="Loading the retired areas" />
  if (areas.length === 0) return <Text size="sm" tone="muted">No retired areas.</Text>

  return (
    <Stack gap={3}>
      {areas.map(area => (
        <Card
          key={area.id}
          title={area.name}
          description={area.description || undefined}
          action={<Badge tone="muted">retired</Badge>}
          footer={(
            <>
              <TextLink href={`/w/${workspaceId}/definition/areas/${area.id}`}>Open {area.name}</TextLink>
              {!readOnly && <Button variant="outline" size="sm" onClick={() => void service.restore(area)}>Restore</Button>}
            </>
          )}
        />
      ))}
      {hasMore && (
        <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.retired.loadMore()}>
          Load more retired areas
        </Button>
      )}
    </Stack>
  )
}
