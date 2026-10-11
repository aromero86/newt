import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, BoxesIcon, FileIcon, MoreHorizontalIcon, PencilIcon, PlusIcon } from 'lucide-react'
import type { FeatureDTO } from '@newt/api/feature'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { PageTitle } from '@newt/ui/components/page-title'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { DefinitionEditDialog } from '../definition-edit-dialog/definition-edit-dialog'
import { DefinitionHistory } from '../definition-history/definition-history'
import { DefinitionPlannedNotice } from '../definition-planned-notice/definition-planned-notice'
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
  const showRetired = useValue(service.showRetired)
  const list = showRetired ? service.retired : service.features
  const features = useValue(list.items)
  const loaded = useValue(list.loaded)
  const failure = useValue(list.failure)
  const hasMore = useValue(list.hasMore)
  const loadingMore = useValue(list.loadingMore)
  const activeTotal = useValue(service.features.total)
  const retiredTotal = useValue(service.retiredTotal)
  const open = useOpenProposal()

  useEffect(() => {
    void service.load(workspaceId, areaId)
  }, [service, workspaceId, areaId])

  if (area === undefined) return <Spinner label="Loading the area" />
  if (area === null) return <NotFound />

  const retiredArea = area.retiredAt !== null
  const readOnly = Boolean(workspace?.archivedAt)
  const definition = `/w/${workspaceId}/definition`

  function actions(feature: FeatureDTO): MenuItem[] {
    if (feature.retiredAt) return [{ label: 'Propose restoring', onSelect: () => void open(service.proposeRestoring(feature)) }]
    return [
      { label: 'Move up', icon: ArrowUpIcon, disabled: feature.position === 0, onSelect: () => void service.move(feature, -1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: feature.position === activeTotal - 1, onSelect: () => void service.move(feature, 1) },
      { separator: true },
      { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(service.proposeRetiring(feature)) },
    ]
  }

  const areaActions: MenuItem[] = retiredArea
    ? [{ label: 'Propose restoring the area', onSelect: () => void open(service.proposeRestoringArea()) }]
    : [
        { label: 'Propose changes', icon: PencilIcon, onSelect: () => service.openEdit() },
        { separator: true },
        { label: area.activeFeatures > 0 ? 'Propose retiring (retire its features first)' : 'Propose retiring the area', tone: 'destructive', disabled: area.activeFeatures > 0, onSelect: () => void open(service.proposeRetiringArea()) },
      ]

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Breadcrumbs items={[{ label: 'Areas', href: definition }, { label: area.name }]} />
        <Inline justify="between" gap={3} wrap>
          <PageTitle>{area.name}</PageTitle>
          {!readOnly && (
            <Menu
              label={`Actions for ${area.name}`}
              align="end"
              trigger={<Button variant="outline" size="sm" label={`Actions for ${area.name}`}><Icon icon={MoreHorizontalIcon} />Actions</Button>}
              items={areaActions}
            />
          )}
        </Inline>
        {area.description && <Text tone="muted">{area.description}</Text>}
        {retiredArea && <Inline><Badge tone="muted">retired</Badge></Inline>}
      </Stack>
      <DefinitionPlannedNotice targetIds={[area.id]} />
      {retiredArea && <Alert tone="info" title="This area is retired">Its features stay readable. Restore it to change them.</Alert>}
      {failure && <Alert tone="bad" title="Could not load the features">{failure}</Alert>}
      <Box label={`Features of ${area.name}`}>
        <BoxHeader actions={!readOnly && !retiredArea && <Button size="sm" onClick={() => service.openCreate()}><Icon icon={PlusIcon} size="sm" />New feature</Button>}>
          <BoxFilter active={!showRetired} icon={BoxesIcon} count={activeTotal} onClick={() => void service.show(false)}>Features</BoxFilter>
          <BoxFilter active={showRetired} icon={ArchiveIcon} count={retiredTotal} onClick={() => void service.show(true)}>Retired</BoxFilter>
        </BoxHeader>
        {loaded && features.length === 0 && <BoxEmpty icon={BoxesIcon} title={showRetired ? 'No retired features' : 'No features in this area'} />}
        {features.map(feature => (
          <BoxRow
            key={feature.id}
            leading={<Icon icon={FileIcon} tone="muted" />}
            trailing={!readOnly && !retiredArea && (
              <Menu
                label={`Actions for ${feature.name}`}
                align="end"
                trigger={<Button variant="ghost" size="icon-sm" label={`Actions for ${feature.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                items={actions(feature)}
              />
            )}
          >
            <BoxRowTitle href={`${definition}/features/${feature.id}`}>{feature.name}</BoxRowTitle>
            {feature.description && <BoxRowMeta>{feature.description.split('\n')[0]}</BoxRowMeta>}
          </BoxRow>
        ))}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void list.loadMore()}>Load more features</Button></BoxFooter>}
      </Box>
      <Box label="Proposals">
        <BoxHeader>Proposals that made it what it is</BoxHeader>
        <BoxBody><DefinitionHistory targetId={area.id} /></BoxBody>
      </Box>
      <DefinitionEditDialog
        form={service.editForm}
        open={editing}
        title={`Propose changes to ${area.name}`}
        onClose={() => service.closeEdit()}
        onSubmit={() => void open(service.saveEdit())}
      />
      <DefinitionAreaCreate />
    </Stack>
  )
}

/** Proposing a new feature in this area, in a quick proposal. */
function DefinitionAreaCreate() {
  const service = useService(DefinitionAreaService)
  const creating = useValue(service.creating)
  const submitting = useValue(service.form.submitting)
  const open = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(service.create())
  }

  return (
    <Dialog open={creating} onOpenChange={next => !next && service.closeCreate()} title="New feature" description="Something that can be done in the product. It goes in a quick proposal, to approve." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.form} name="name" label="Name" description="For instance: Checkout, or Pay with Bizum." />
          <FormField form={service.form} name="description" label="Description" description="What it covers, and what it does not." rows={3} />
          <Inline justify="end"><Button type="submit" loading={submitting}>Propose</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
