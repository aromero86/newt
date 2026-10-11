import { useEffect } from 'react'
import { useParams } from 'react-router'
import { MoreHorizontalIcon } from 'lucide-react'
import type { RuleCriterionDTO } from '@newt/api/rule'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Menu } from '@newt/ui/components/menu'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { RuleScope } from '../../../components/rule-scope'
import { DefinitionHistory } from '../definition-history/definition-history'
import { DefinitionPlannedNotice } from '../definition-planned-notice/definition-planned-notice'
import { DefinitionRulePropose } from '../definition-rule-propose/definition-rule-propose'
import { DefinitionRuleProposeService } from '../definition-rule-propose/definition-rule-propose.service'
import { DefinitionRuleService } from './definition-rule.service'

/** With its own services: whoever renders it needs nothing else. */
export function DefinitionRule() {
  return (
    <Provide services={[DefinitionRuleService, DefinitionRuleProposeService]}>
      <DefinitionRuleWrapped />
    </Provide>
  )
}

/** One rule: what it says, where it applies, why, its criteria and its history. */
function DefinitionRuleWrapped() {
  const { workspaceId, key } = useParams() as { workspaceId: string, key: string }
  const service = useService(DefinitionRuleService)
  const rule = useValue(service.rule)
  const dimensions = useValue(service.dimensions)
  const versions = useValue(service.versions.items)
  const hasMore = useValue(service.versions.hasMore)
  const loadingMore = useValue(service.versions.loadingMore)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const propose = useService(DefinitionRuleProposeService)
  const quick = useService(QuickProposalService)
  const open = useOpenProposal()

  useEffect(() => {
    void service.load(workspaceId, key)
  }, [service, workspaceId, key])

  if (rule === undefined) return <Spinner label="Loading the rule" />
  if (rule === null) return <NotFound />

  const { current } = rule
  const retired = rule.retiredAt !== null

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Inline gap={2} wrap>
          <ArtifactTag kind="rule" id={rule.key} />
          <TextLink href={`/w/${workspaceId}/definition/features/${rule.featureId}`}>{rule.featureName}</TextLink>
        </Inline>
        <PageHeader
          title={current.statement}
          actions={(
            <Inline gap={2}>
              <Badge tone="muted">{current.kind}</Badge>
              <Badge tone="outline">version {current.version}</Badge>
              {retired && <Badge tone="warn">retired</Badge>}
              {!retired && !workspace?.archivedAt && (
                <Menu
                  label={`Actions for ${rule.key}`}
                  align="end"
                  trigger={<Button variant="outline" size="icon" label={`Actions for ${rule.key}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                  items={[
                    { label: 'Propose a new version', onSelect: () => void propose.startChange(workspaceId, rule) },
                    { separator: true },
                    { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(quick.propose(workspaceId, { kind: 'rule', operation: 'retire', targetId: rule.id })) },
                  ]}
                />
              )}
            </Inline>
          )}
        />
      </Stack>
      <DefinitionPlannedNotice targetIds={[rule.id]} />
      {retired && <Alert tone="info" title={`${rule.key} is retired`}>It no longer holds. This is what it said last.</Alert>}
      <Card title="Where it applies" titleLevel={2}>
        <RuleScope scope={current.scope} dimensions={dimensions} />
      </Card>
      <Card title="Why" titleLevel={2}>
        <Text>{current.why}</Text>
      </Card>
      <Card title="Acceptance criteria" titleLevel={2}>
        {current.criteria.length === 0
          ? <Text size="sm" tone="muted">No criteria yet.</Text>
          : <Stack gap={4}>{current.criteria.map((criterion, index) => <DefinitionRuleCriterion key={index} criterion={criterion} />)}</Stack>}
      </Card>
      <Card title="Proposals" titleLevel={2} description="The merged proposals that made it what it is.">
        <DefinitionHistory targetId={rule.id} />
      </Card>
      <Card title="History" titleLevel={2} description="A rule is never edited: each version replaces the one before.">
        <Stack gap={6}>
          {versions.map(version => (
            <Stack key={version.id} gap={2}>
              <Inline gap={2} wrap>
                <Text size="sm" weight="semibold">Version {version.version}</Text>
                <Text size="sm" tone="muted">{new Date(version.createdAt).toLocaleDateString('en', { dateStyle: 'medium' })}</Text>
                {version.id === current.id && <Badge tone={retired ? 'muted' : 'ok'}>{retired ? 'last' : 'in force'}</Badge>}
              </Inline>
              <Text>{version.statement}</Text>
              <RuleScope scope={version.scope} dimensions={dimensions} />
            </Stack>
          ))}
          {hasMore && (
            <Inline>
              <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.versions.loadMore()}>
                Load older versions
              </Button>
            </Inline>
          )}
        </Stack>
      </Card>
      <DefinitionRulePropose />
    </Stack>
  )
}

/** Given… when… then… */
function DefinitionRuleCriterion({ criterion }: { criterion: RuleCriterionDTO }) {
  return (
    <Stack gap={1}>
      <Text size="sm"><Text as="span" size="sm" weight="semibold">Given</Text> {criterion.given}</Text>
      <Text size="sm"><Text as="span" size="sm" weight="semibold">When</Text> {criterion.when}</Text>
      <Text size="sm"><Text as="span" size="sm" weight="semibold">Then</Text> {criterion.then}</Text>
    </Stack>
  )
}
