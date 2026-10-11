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
import { DefinitionHistoryService } from './definition-history.service'

const VERB = { create: 'created it', change: 'changed it', retire: 'retired it', restore: 'restored it' } as const

/** With its own DefinitionHistoryService: whoever renders it needs nothing else. */
export function DefinitionHistory({ targetId }: { targetId: string }) {
  return (
    <Provide services={[DefinitionHistoryService]}>
      <DefinitionHistoryWrapped targetId={targetId} />
    </Provide>
  )
}

/** Where an artifact comes from: the merged proposals that made it what it is, each with its document. */
function DefinitionHistoryWrapped({ targetId }: { targetId: string }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionHistoryService)
  const history = useValue(service.history.items)
  const loaded = useValue(service.history.loaded)
  const hasMore = useValue(service.history.hasMore)
  const loadingMore = useValue(service.history.loadingMore)

  useEffect(() => {
    void service.load(workspaceId, targetId)
  }, [service, workspaceId, targetId])

  if (!loaded) return null
  if (history.length === 0) return <Text size="sm" tone="muted">No merged proposal has changed it: it was there before proposals.</Text>

  return (
    <Stack gap={1}>
      {history.map(({ proposal, delta }) => (
        <Inline key={delta.id} gap={1} wrap>
          <TextLink href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.key}</TextLink>
          <Text size="sm">{`${VERB[delta.operation]} · ${proposal.title}`}</Text>
        </Inline>
      ))}
      {hasMore && <Inline><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.history.loadMore()}>Load more</Button></Inline>}
    </Stack>
  )
}
