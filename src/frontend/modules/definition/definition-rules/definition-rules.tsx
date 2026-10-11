import { useEffect } from 'react'
import { useParams } from 'react-router'
import { ArchiveIcon, ScrollTextIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Inline } from '@newt/ui/components/inline'
import { Select } from '@newt/ui/components/select'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { RuleScope } from '../../../components/rule-scope'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
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

/** Rules page by page, like a repository's issues: filtered, in the box's header, by the values they apply in. */
function DefinitionRulesWrapped({ featureId }: DefinitionRulesProps) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionRulesService)
  const dimensions = useValue(service.dimensions)
  const appliesIn = useValue(service.appliesIn)
  const retired = useValue(service.retired)
  const rules = useValue(service.rules.items)
  const total = useValue(service.rules.total)
  const loaded = useValue(service.rules.loaded)
  const failure = useValue(service.rules.failure)
  const hasMore = useValue(service.rules.hasMore)
  const loadingMore = useValue(service.rules.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, featureId)
  }, [service, workspaceId, featureId])

  const filtered = Object.keys(appliesIn).length > 0

  return (
    <Box label="Rules">
      <BoxHeader
        actions={dimensions.map(dimension => (
          <Select
            key={dimension.id}
            label={`Applies in ${dimension.name}`}
            size="compact"
            value={appliesIn[dimension.id] ?? ANYWHERE}
            onValueChange={value => void service.filter(dimension.id, value === ANYWHERE ? undefined : value)}
            options={[
              { value: ANYWHERE, label: `${dimension.name}: any` },
              ...dimension.values.filter(value => !value.retiredAt).map(value => ({ value: value.id, label: `${dimension.name}: ${value.name}` })),
            ]}
          />
        ))}
      >
        <BoxFilter active={!retired} icon={ScrollTextIcon} count={retired ? undefined : total} onClick={() => void service.showRetired(false)}>In force</BoxFilter>
        <BoxFilter active={retired} icon={ArchiveIcon} count={retired ? total : undefined} onClick={() => void service.showRetired(true)}>Retired</BoxFilter>
      </BoxHeader>
      {failure && <Alert tone="bad" title="Could not load the rules">{failure}</Alert>}
      {loaded && rules.length === 0 && (
        <BoxEmpty icon={ScrollTextIcon} title={filtered ? 'No rules apply there' : retired ? 'No retired rules' : 'No rules yet'} description={!filtered && !retired ? 'What must always hold true. Rules are proposed from a feature.' : undefined} />
      )}
      {rules.map(rule => (
        <BoxRow key={rule.id} leading={<ArtifactTag kind="rule" id={rule.key} />} trailing={<Badge tone="muted">{rule.current.kind}</Badge>}>
          <BoxRowTitle href={`/w/${workspaceId}/definition/rules/${rule.key}`}>{rule.current.statement}</BoxRowTitle>
          <BoxRowMeta>
            {!featureId && <span>{rule.featureName}</span>}
            <RuleScope scope={rule.current.scope} dimensions={dimensions} size="xs" />
          </BoxRowMeta>
        </BoxRow>
      ))}
      {hasMore && (
        <BoxFooter>
          <Inline><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.rules.loadMore()}>Load more rules</Button></Inline>
        </BoxFooter>
      )}
    </Box>
  )
}
