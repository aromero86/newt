import { useEffect } from 'react'
import { useParams } from 'react-router'
import { GitCommitHorizontalIcon, MoreHorizontalIcon } from 'lucide-react'
import type { RuleCriterionDTO } from '@newt/api/rule'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxEmpty, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Menu } from '@newt/ui/components/menu'
import { PageTitle } from '@newt/ui/components/page-title'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { SidebarLayout, SidebarSection } from '@newt/ui/components/sidebar-layout'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Timeline, TimelineItem } from '@newt/ui/components/timeline'
import { RuleScope } from '../../../components/rule-scope'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { QuickProposalService } from '../../../services/quick-proposal/quick-proposal.service'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
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

/** One rule: what it says and why, its criteria and its versions; where it applies and where it came from beside. */
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
  const definition = `/w/${workspaceId}/definition`

  const aside = (
    <div>
      <SidebarSection title="Where it applies"><RuleScope scope={current.scope} dimensions={dimensions} /></SidebarSection>
      <SidebarSection title="Feature"><TextLink href={`${definition}/features/${rule.featureId}`}>{rule.featureName}</TextLink></SidebarSection>
      <SidebarSection title="Kind"><Badge tone="muted">{current.kind}</Badge></SidebarSection>
      <SidebarSection title="Version"><Text size="sm">{`${current.version}${retired ? ', the last one' : ', in force'}`}</Text></SidebarSection>
      <SidebarSection title="Proposals"><DefinitionHistory targetId={rule.id} /></SidebarSection>
    </div>
  )

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Breadcrumbs items={[{ label: 'Rules', href: `${definition}/rules` }, { label: rule.key }]} />
        <Inline justify="between" gap={3} wrap>
          <PageTitle reference={rule.key}>{current.statement}</PageTitle>
          {!retired && !workspace?.archivedAt && (
            <Menu
              label={`Actions for ${rule.key}`}
              align="end"
              trigger={<Button variant="outline" size="sm" label={`Actions for ${rule.key}`}><Icon icon={MoreHorizontalIcon} />Actions</Button>}
              items={[
                { label: 'Propose a new version', onSelect: () => void propose.startChange(workspaceId, rule) },
                { separator: true },
                { label: 'Propose retiring', tone: 'destructive', onSelect: () => void open(quick.propose(workspaceId, { kind: 'rule', operation: 'retire', targetId: rule.id })) },
              ]}
            />
          )}
        </Inline>
        {retired && <Inline><Badge tone="warn">retired</Badge></Inline>}
      </Stack>
      <DefinitionPlannedNotice targetIds={[rule.id]} />
      {retired && <Alert tone="info" title={`${rule.key} is retired`}>It no longer holds. This is what it said last.</Alert>}
      <SidebarLayout side="end" aside={aside}>
        <Stack gap={6}>
          <Box label="Why">
            <BoxHeader>Why it holds</BoxHeader>
            <BoxBody><Text size="sm">{current.why}</Text></BoxBody>
          </Box>
          <Box label="Acceptance criteria">
            <BoxHeader>{`Acceptance criteria (${current.criteria.length})`}</BoxHeader>
            {current.criteria.length === 0 && <BoxEmpty title="No criteria yet" description="Concrete examples: given… when… then…" />}
            {current.criteria.map((criterion, index) => <BoxRow key={index}><DefinitionRuleCriterion criterion={criterion} /></BoxRow>)}
          </Box>
          <Stack gap={3}>
            <Text size="sm" weight="semibold">History</Text>
            <Text size="sm" tone="muted">A rule is never edited: each version replaces the one before.</Text>
            <Timeline>
              {versions.map(version => (
                <TimelineItem key={version.id} icon={GitCommitHorizontalIcon} tone={version.id === current.id && !retired ? 'ok' : 'muted'}>
                  <Inline gap={2} wrap>
                    <Text size="sm" weight="semibold" as="span">{`Version ${version.version}`}</Text>
                    <Text size="sm" tone="muted" as="span"><RelativeTime date={version.createdAt} /></Text>
                    {version.id === current.id && <Badge tone={retired ? 'muted' : 'ok'}>{retired ? 'last' : 'in force'}</Badge>}
                  </Inline>
                  <Text size="sm">{version.statement}</Text>
                  <RuleScope scope={version.scope} dimensions={dimensions} />
                </TimelineItem>
              ))}
            </Timeline>
            {hasMore && <Inline><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.versions.loadMore()}>Load older versions</Button></Inline>}
          </Stack>
        </Stack>
      </SidebarLayout>
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
