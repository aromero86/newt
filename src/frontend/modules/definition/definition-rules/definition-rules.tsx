import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Field } from '@newt/ui/components/field'
import { Grid } from '@newt/ui/components/grid'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Select } from '@newt/ui/components/select'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { DefinitionRuleScope } from '../definition-rule-scope/definition-rule-scope'
import { DefinitionRulesService } from './definition-rules.service'

const ANYWHERE = 'anywhere'

type DefinitionRulesProps = {
  /** Only this feature's rules; without it, the whole workspace's, each with its feature. */
  featureId?: string
}

/** With its own DefinitionRulesService: whoever renders it needs nothing else. */
export function DefinitionRules(props: DefinitionRulesProps) {
  return (
    <Provide services={[DefinitionRulesService]}>
      <DefinitionRulesWrapped {...props} />
    </Provide>
  )
}

/** Rules page by page, filtered by the values they apply in. */
function DefinitionRulesWrapped({ featureId }: DefinitionRulesProps) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionRulesService)
  const dimensions = useValue(service.dimensions)
  const appliesIn = useValue(service.appliesIn)
  const retired = useValue(service.retired)
  const rules = useValue(service.rules.items)
  const total = useValue(service.rules.total)
  const loaded = useValue(service.rules.loaded)
  const loading = useValue(service.rules.loading)
  const failure = useValue(service.rules.failure)
  const hasMore = useValue(service.rules.hasMore)
  const loadingMore = useValue(service.rules.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, featureId)
  }, [service, workspaceId, featureId])

  const filtered = Object.keys(appliesIn).length > 0

  return (
    <Card title={`${retired ? 'Retired rules' : 'Rules'} (${total})`} titleLevel={2} description="What must always hold true.">
      <Stack gap={6}>
        {dimensions.length > 0 && (
          <Grid columns={{ base: 1, md: 3 }} gap={4}>
            {dimensions.map(dimension => (
              <Field key={dimension.id} label={dimension.name}>
                <Select
                  value={appliesIn[dimension.id] ?? ANYWHERE}
                  onValueChange={value => void service.filter(dimension.id, value === ANYWHERE ? undefined : value)}
                  options={[
                    { value: ANYWHERE, label: 'Any' },
                    ...dimension.values.filter(value => !value.retiredAt).map(value => ({ value: value.id, label: value.name })),
                  ]}
                />
              </Field>
            ))}
          </Grid>
        )}
        {failure && <Alert tone="bad" title="Could not load the rules">{failure}</Alert>}
        {!loaded && !failure && <Spinner label="Loading the rules" />}
        {loaded && rules.length === 0 && (
          <Text size="sm" tone="muted">{filtered ? 'No rules apply there.' : retired ? 'No retired rules.' : 'No rules yet.'}</Text>
        )}
        {rules.length > 0 && (
          <Stack gap={4}>
            {rules.map(rule => (
              <Stack key={rule.id} gap={2}>
                <Inline gap={2} wrap>
                  <ArtifactTag kind="rule" id={rule.key} />
                  <TextLink href={`/w/${workspaceId}/definition/rules/${rule.key}`}>{rule.current.statement}</TextLink>
                </Inline>
                <Inline gap={2} wrap>
                  <Badge tone="muted">{rule.current.kind}</Badge>
                  {!featureId && <Text size="sm" tone="muted">{rule.featureName}</Text>}
                  <DefinitionRuleScope scope={rule.current.scope} dimensions={dimensions} />
                </Inline>
              </Stack>
            ))}
          </Stack>
        )}
        <Inline gap={2} wrap>
          {hasMore && (
            <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.rules.loadMore()}>
              Load more rules
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => void service.showRetired(!retired)}>
            {retired ? 'Show rules in force' : 'Show retired rules'}
          </Button>
        </Inline>
      </Stack>
    </Card>
  )
}
