import { useEffect } from 'react'
import { useParams } from 'react-router'
import type { RuleCriterionDTO } from '@newt/api/rule'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { RuleScope } from '../../../components/rule-scope'
import { DefinitionRuleService } from './definition-rule.service'

/** With its own DefinitionRuleService: whoever renders it needs nothing else. */
export function DefinitionRule() {
  return (
    <Provide services={[DefinitionRuleService]}>
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
            </Inline>
          )}
        />
      </Stack>
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
