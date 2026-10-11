import { useEffect } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { BoxIcon, FolderIcon, GitPullRequestIcon, PuzzleIcon, ScrollTextIcon, SearchIcon, XIcon } from 'lucide-react'
import type { SearchResultDTO } from '@newt/api/search'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { SearchField } from '@newt/ui/components/search-field'
import { Select } from '@newt/ui/components/select'
import { Stack } from '@newt/ui/components/stack'
import { Strong, Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'
import { Provide } from '../../core/injector/provide'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { SearchService } from './search.service'

const ANYWHERE = 'anywhere'

const KIND_ICON = { 'feature-area': FolderIcon, 'feature': PuzzleIcon, 'rule': ScrollTextIcon, 'proposal': GitPullRequestIcon }

/** With its own SearchService: whoever renders it needs nothing else. */
export function Search() {
  return (
    <Provide services={[SearchService]}>
      <SearchWrapped />
    </Provide>
  )
}

/** A workspace's search: what matches by words and by meaning, narrowed like a repository's issues. */
function SearchWrapped() {
  const workspaceId = useParams().workspaceId!
  const [params] = useSearchParams()
  const query = params.get('query') ?? ''
  const featureId = params.get('featureId') ?? undefined
  const navigate = useNavigate()
  const service = useService(SearchService)
  const feature = useValue(service.feature)
  const kind = useValue(service.kind)
  const definition = useValue(service.definition)
  const history = useValue(service.history)
  const dimensions = useValue(service.dimensions)
  const appliesIn = useValue(service.appliesIn)
  const semantic = useValue(service.semantic)
  const results = useValue(service.results.items)
  const total = useValue(service.results.total)
  const loaded = useValue(service.results.loaded)
  const failure = useValue(service.results.failure)
  const hasMore = useValue(service.results.hasMore)
  const loadingMore = useValue(service.results.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, query, featureId)
  }, [service, workspaceId, query, featureId])

  const search = (next: string, inFeature = featureId) => navigate(`/w/${workspaceId}/search?query=${encodeURIComponent(next)}${inFeature ? `&featureId=${inFeature}` : ''}`)
  const kindFilter = (value: typeof kind, label: string, icon: typeof BoxIcon) => (
    <BoxFilter active={kind === value} icon={icon} count={kind === value && loaded ? total : undefined} onClick={() => void service.narrow({ kind: value })}>{label}</BoxFilter>
  )

  return (
    <Stack gap={4}>
      <SearchField
        label={feature ? `Search in ${feature.name}` : 'Search this workspace'}
        placeholder={feature ? `Search in ${feature.name}, in your own words` : 'Search rules, features, areas and proposals, in your own words'}
        defaultValue={query}
        onSearch={next => search(next)}
      />
      {feature && (
        <Inline gap={2} wrap>
          <Text size="sm" tone="muted">{'Only in the feature '}<Strong>{feature.name}</Strong></Text>
          <Button size="sm" variant="ghost" onClick={() => search(query, undefined)}><Icon icon={XIcon} size="sm" />Search the whole workspace</Button>
        </Inline>
      )}
      {query && semantic !== 'ready' && (
        <Alert tone="info" title="Searching by words only">
          {semantic === 'loading' ? 'The model that finds things by their meaning is getting ready: search again in a moment.' : 'The model that finds things by their meaning is not available.'}
        </Alert>
      )}
      {failure && <Alert tone="bad" title="Could not search">{failure}</Alert>}
      {query && (
        <Box label="Results">
          <BoxHeader
            actions={(
              <>
                <Select
                  label="Definition"
                  size="compact"
                  value={definition}
                  onValueChange={value => void service.narrow({ definition: value as typeof definition })}
                  options={[{ value: 'in force', label: 'In force' }, { value: 'planned', label: 'Planned too' }]}
                />
                <Select
                  label="History"
                  size="compact"
                  value={history ? 'with' : 'without'}
                  onValueChange={value => void service.narrow({ history: value === 'with' })}
                  options={[{ value: 'without', label: 'Without history' }, { value: 'with', label: 'With history' }]}
                />
                {dimensions.map(dimension => (
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
              </>
            )}
          >
            {kindFilter(undefined, 'All', SearchIcon)}
            {kindFilter('rule', 'Rules', ScrollTextIcon)}
            {kindFilter('feature', 'Features', PuzzleIcon)}
            {kindFilter('feature-area', 'Areas', FolderIcon)}
            {kindFilter('proposal', 'Proposals', GitPullRequestIcon)}
          </BoxHeader>
          {loaded && results.length === 0 && <BoxEmpty icon={SearchIcon} title="Nothing found" description="Try other words, or include the planned definition and the history." />}
          {results.map(result => <SearchResult key={result.id} workspaceId={workspaceId} result={result} />)}
          {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.results.loadMore()}>Load more results</Button></BoxFooter>}
        </Box>
      )}
    </Stack>
  )
}

/** Where a result belongs, when it is not the definition in force. */
function SearchResultBadge({ result }: { result: SearchResultDTO }) {
  if (result.layer === 'planned') return <Badge tone="info">{`${result.status} · ${result.proposal?.key}`}</Badge>
  if (result.status === 'superseded') return <Badge tone="muted">{`superseded · v${result.version}, now v${result.currentVersion}`}</Badge>
  if (result.layer === 'history') return <Badge tone="muted">{result.status}</Badge>
  if (result.kind === 'proposal') return <Badge tone="outline">{result.status}</Badge>
  return null
}

function SearchResult({ workspaceId, result }: { workspaceId: string, result: SearchResultDTO }) {
  const base = `/w/${workspaceId}`
  const href = result.kind === 'proposal' ? `${base}/proposals/${result.key}`
    : result.layer === 'planned' && result.proposal ? `${base}/proposals/${result.proposal.key}`
      : result.kind === 'rule' && result.key ? `${base}/definition/rules/${result.key}`
        : result.kind === 'feature' ? `${base}/definition/features/${result.targetId}`
          : `${base}/definition/areas/${result.targetId}`

  return (
    <BoxRow
      leading={result.kind === 'rule' ? <ArtifactTag kind="rule" id={result.key ?? 'new'} /> : <Icon icon={KIND_ICON[result.kind]} tone="muted" />}
      trailing={<SearchResultBadge result={result} />}
    >
      <BoxRowTitle href={href}>{result.kind === 'proposal' ? `${result.key} · ${result.label}` : result.label}</BoxRowTitle>
      <BoxRowMeta>
        {result.feature && result.kind !== 'feature' && <span>{result.feature.name}</span>}
        {result.scope && (result.scope.length === 0
          ? <span>Applies everywhere</span>
          : <Inline gap={1} wrap>{result.scope.flatMap(({ dimension, values }) => values.map(value => <DimensionChip key={`${dimension}-${value}`} name={dimension} value={value} />))}</Inline>)}
      </BoxRowMeta>
      {result.snippet && result.snippet !== result.label && <Text size="xs" tone="muted">{result.snippet}</Text>}
    </BoxRow>
  )
}
