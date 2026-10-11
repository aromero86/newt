import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, FolderIcon, FolderTreeIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react'
import type { FeatureAreaDTO } from '@newt/api/feature-area'
import { Alert } from '@newt/ui/components/alert'
import { Box, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
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
  const showRetired = useValue(service.showRetired)
  const list = showRetired ? service.retired : service.active
  const areas = useValue(list.items)
  const loaded = useValue(list.loaded)
  const failure = useValue(list.failure)
  const hasMore = useValue(list.hasMore)
  const loadingMore = useValue(list.loadingMore)
  const activeTotal = useValue(service.active.total)
  const retiredTotal = useValue(service.retiredTotal)
  const open = useOpenProposal()
  const readOnly = Boolean(workspace?.archivedAt)
  const base = `/w/${workspaceId}/definition`

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  function actions(area: FeatureAreaDTO): MenuItem[] {
    if (area.retiredAt) return [{ label: 'Propose restoring', onSelect: () => void open(service.proposeRestoring(area)) }]
    return [
      { label: 'Move up', icon: ArrowUpIcon, disabled: area.position === 0, onSelect: () => void service.move(area, -1) },
      { label: 'Move down', icon: ArrowDownIcon, disabled: area.position === activeTotal - 1, onSelect: () => void service.move(area, 1) },
      { separator: true },
      { label: area.activeFeatures > 0 ? 'Propose retiring (retire its features first)' : 'Propose retiring', tone: 'destructive', disabled: area.activeFeatures > 0, onSelect: () => void open(service.proposeRetiring(area)) },
    ]
  }

  return (
    <Stack gap={4}>
      <Subhead title="Areas and features" description="What your product does today, area by area: Checkout, Account, Backoffice…" />
      {failure && <Alert tone="bad" title="Could not load the areas">{failure}</Alert>}
      <Box label="Areas">
        <BoxHeader actions={!readOnly && <Button size="sm" onClick={() => service.openCreate()}><Icon icon={PlusIcon} size="sm" />New area</Button>}>
          <BoxFilter active={!showRetired} icon={FolderTreeIcon} count={activeTotal} onClick={() => void service.show(false)}>Active</BoxFilter>
          <BoxFilter active={showRetired} icon={ArchiveIcon} count={retiredTotal} onClick={() => void service.show(true)}>Retired</BoxFilter>
        </BoxHeader>
        {loaded && areas.length === 0 && (
          <BoxEmpty
            icon={FolderTreeIcon}
            title={showRetired ? 'No retired areas' : 'No areas yet'}
            description={showRetired ? undefined : 'Group your features by part of the product: Checkout, Account, Backoffice…'}
          />
        )}
        {areas.map(area => (
          <BoxRow
            key={area.id}
            leading={<Icon icon={FolderIcon} tone="muted" />}
            trailing={(
              <>
                {!area.retiredAt && <span>{area.activeFeatures === 1 ? '1 feature' : `${area.activeFeatures} features`}</span>}
                {!readOnly && (
                  <Menu
                    label={`Actions for ${area.name}`}
                    align="end"
                    trigger={<Button variant="ghost" size="icon-sm" label={`Actions for ${area.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                    items={actions(area)}
                  />
                )}
              </>
            )}
          >
            <BoxRowTitle href={`${base}/areas/${area.id}`}>{area.name}</BoxRowTitle>
            {area.description && <BoxRowMeta>{area.description.split('\n')[0]}</BoxRowMeta>}
          </BoxRow>
        ))}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void list.loadMore()}>Load more areas</Button></BoxFooter>}
      </Box>
      <DefinitionAreasCreate />
    </Stack>
  )
}

/** Proposing a new area, in a quick proposal. */
function DefinitionAreasCreate() {
  const service = useService(DefinitionAreasService)
  const creating = useValue(service.creating)
  const submitting = useValue(service.form.submitting)
  const open = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(service.create())
  }

  return (
    <Dialog
      open={creating}
      onOpenChange={next => !next && service.closeCreate()}
      title="New area"
      description="A part of the product, such as Checkout or Account; where things apply is said by dimensions. It goes in a quick proposal, to approve."
      size="md"
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.form} name="name" label="Name" />
          <FormField form={service.form} name="description" label="Description" description="What it covers, and what it does not." rows={3} />
          <Inline justify="end"><Button type="submit" loading={submitting}>Propose</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
