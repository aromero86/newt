import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Button } from '@newt/ui/components/button'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { DefinitionSimilarService } from './definition-similar.service'

/** With its own DefinitionSimilarService: whoever renders it needs nothing else. */
export function DefinitionSimilar({ targetId }: { targetId: string }) {
  return (
    <Provide services={[DefinitionSimilarService]}>
      <DefinitionSimilarWrapped targetId={targetId} />
    </Provide>
  )
}

/** The rules and features in force that talk about the same as an artifact, closest first. */
function DefinitionSimilarWrapped({ targetId }: { targetId: string }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionSimilarService)
  const similar = useValue(service.similar.items)
  const loaded = useValue(service.similar.loaded)
  const semantic = useValue(service.semantic)
  const hasMore = useValue(service.similar.hasMore)
  const loadingMore = useValue(service.similar.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, targetId)
  }, [service, workspaceId, targetId])

  if (!loaded) return null
  if (semantic !== 'ready' && similar.length === 0) return <Text size="sm" tone="muted">Not available yet: the model that finds things by their meaning is getting ready.</Text>
  if (similar.length === 0) return <Text size="sm" tone="muted">Nothing else talks about the same.</Text>

  const base = `/w/${workspaceId}/definition`
  return (
    <Stack gap={1}>
      {similar.map(result => (
        <Inline key={result.id} gap={1} wrap>
          {result.kind === 'rule'
            ? <><TextLink href={`${base}/rules/${result.key}`}>{result.key}</TextLink><Text size="sm">{result.label}</Text></>
            : <><Text size="sm" tone="muted">Feature</Text><TextLink href={`${base}/features/${result.targetId}`}>{result.label}</TextLink></>}
        </Inline>
      ))}
      {hasMore && <Inline><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.similar.loadMore()}>Load more</Button></Inline>}
    </Stack>
  )
}
