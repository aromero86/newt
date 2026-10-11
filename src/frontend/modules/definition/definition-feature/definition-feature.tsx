import { useEffect } from 'react'
import { useParams } from 'react-router'
import { FolderInputIcon, MoreHorizontalIcon, PencilIcon, PlusIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxHeader } from '@newt/ui/components/box'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { PageTitle } from '@newt/ui/components/page-title'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { DefinitionEditDialog } from '../definition-edit-dialog/definition-edit-dialog'
import { DefinitionHistory } from '../definition-history/definition-history'
import { DefinitionPlannedNotice } from '../definition-planned-notice/definition-planned-notice'
import { DefinitionRulePropose } from '../definition-rule-propose/definition-rule-propose'
import { DefinitionRuleProposeService } from '../definition-rule-propose/definition-rule-propose.service'
import { DefinitionRules } from '../definition-rules/definition-rules'
import { DefinitionFeatureMove } from './definition-feature-move'
import { DefinitionFeatureService } from './definition-feature.service'

/** With its own services: whoever renders it needs nothing else. */
export function DefinitionFeature() {
  return (
    <Provide services={[DefinitionFeatureService, DefinitionRuleProposeService]}>
      <DefinitionFeatureWrapped />
    </Provide>
  )
}

/** One feature: what it covers, its rules, and where it came from. */
function DefinitionFeatureWrapped() {
  const { workspaceId, featureId } = useParams() as { workspaceId: string, featureId: string }
  const service = useService(DefinitionFeatureService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const feature = useValue(service.feature)
  const area = useValue(service.area)
  const editing = useValue(service.editing)
  const rules = useService(DefinitionRuleProposeService)
  const open = useOpenProposal()

  useEffect(() => {
    void service.load(workspaceId, featureId)
  }, [service, workspaceId, featureId])

  if (feature === undefined) return <Spinner label="Loading the feature" />
  if (feature === null) return <NotFound />

  const retired = feature.retiredAt !== null
  const readOnly = Boolean(workspace?.archivedAt)
  const definition = `/w/${workspaceId}/definition`

  const actions: MenuItem[] = retired
    ? [{ label: 'Propose restoring', onSelect: () => void open(service.proposeRestoring()) }]
    : [
        { label: 'Propose changes', icon: PencilIcon, onSelect: () => service.openEdit() },
        { label: 'Propose moving to another area', icon: FolderInputIcon, onSelect: () => void service.openMove() },
        { separator: true },
        { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(service.proposeRetiring()) },
      ]

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Breadcrumbs items={[{ label: 'Areas', href: definition }, ...(area ? [{ label: area.name, href: `${definition}/areas/${area.id}` }] : []), { label: feature.name }]} />
        <Inline justify="between" gap={3} wrap>
          <PageTitle>{feature.name}</PageTitle>
          {!readOnly && (
            <Inline gap={2}>
              {!retired && <Button size="sm" variant="outline" onClick={() => void rules.startNew(workspaceId, feature.id)}><Icon icon={PlusIcon} size="sm" />Propose a rule</Button>}
              <Menu
                label={`Actions for ${feature.name}`}
                align="end"
                trigger={<Button variant="outline" size="icon-sm" label={`Actions for ${feature.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                items={actions}
              />
            </Inline>
          )}
        </Inline>
        {retired && <Inline><Badge tone="muted">retired</Badge></Inline>}
      </Stack>
      <DefinitionPlannedNotice targetIds={[feature.id]} />
      {retired && <Alert tone="info" title="This feature is retired">It is no longer in the product. This is what it was.</Alert>}
      <Box label="Description">
        <BoxHeader>About</BoxHeader>
        <BoxBody>
          {feature.description
            ? <Stack gap={2}>{feature.description.split(/\n+/).map((paragraph, index) => <Text key={index} size="sm">{paragraph}</Text>)}</Stack>
            : <Text size="sm" tone="muted">No description yet.</Text>}
        </BoxBody>
      </Box>
      <DefinitionRules featureId={feature.id} />
      <Box label="Proposals">
        <BoxHeader>Proposals that made it what it is</BoxHeader>
        <BoxBody><DefinitionHistory targetId={feature.id} /></BoxBody>
      </Box>
      <DefinitionEditDialog
        form={service.editForm}
        open={editing}
        title={`Propose changes to ${feature.name}`}
        onClose={() => service.closeEdit()}
        onSubmit={() => void open(service.saveEdit())}
      />
      <DefinitionFeatureMove />
      <DefinitionRulePropose />
    </Stack>
  )
}
