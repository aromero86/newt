import { useEffect } from 'react'
import { useParams } from 'react-router'
import { MoreHorizontalIcon } from 'lucide-react'
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
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { DefinitionEditDialog } from '../definition-edit-dialog/definition-edit-dialog'
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

/** One feature: what it covers, and where it sits. */
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
  const areaPath = `/w/${workspaceId}/definition/areas/${feature.areaId}`

  const actions: MenuItem[] = retired
    ? [{ label: 'Propose restoring', onSelect: () => void open(service.proposeRestoring()) }]
    : [
        { label: 'Propose a rule', onSelect: () => void rules.startNew(workspaceId, feature.id) },
        { label: 'Propose changes', onSelect: () => service.openEdit() },
        { label: 'Propose moving to another area', onSelect: () => void service.openMove() },
        { separator: true },
        { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(service.proposeRetiring()) },
      ]

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        {area && <TextLink href={areaPath}>{area.name}</TextLink>}
        <PageHeader
          title={feature.name}
          actions={(
            <Inline gap={2}>
              {retired && <Badge tone="muted">retired</Badge>}
              {!readOnly && (
                <Menu
                  label={`Actions for ${feature.name}`}
                  align="end"
                  trigger={<Button variant="outline" size="icon" label={`Actions for ${feature.name}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                  items={actions}
                />
              )}
            </Inline>
          )}
        />
      </Stack>
      <DefinitionPlannedNotice targetIds={[feature.id]} />
      {retired && <Alert tone="info" title="This feature is retired">It is no longer in the product. This is what it was.</Alert>}
      <Card title="Description" titleLevel={2}>
        {feature.description
          ? <Stack gap={2}>{feature.description.split(/\n+/).map((paragraph, index) => <Text key={index}>{paragraph}</Text>)}</Stack>
          : <Text tone="muted">No description yet.</Text>}
      </Card>
      <DefinitionRules featureId={feature.id} />
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
