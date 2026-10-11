import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { DefinitionPlannedNoticeService } from './definition-planned-notice.service'

const VERB = { create: 'creates', change: 'changes', retire: 'retires', restore: 'restores' } as const

/** With its own DefinitionPlannedNoticeService: whoever renders it needs nothing else. */
export function DefinitionPlannedNotice({ targetIds }: { targetIds: string[] }) {
  return (
    <Provide services={[DefinitionPlannedNoticeService]}>
      <DefinitionPlannedNoticeWrapped targetIds={targetIds} />
    </Provide>
  )
}

/** Says what accepted proposals will change here once their code is in; nothing if none. */
function DefinitionPlannedNoticeWrapped({ targetIds }: { targetIds: string[] }) {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionPlannedNoticeService)
  const planned = useValue(service.planned.items)
  const hasMore = useValue(service.planned.hasMore)
  const key = targetIds.join(',')

  useEffect(() => {
    // Without artifacts there is nothing to look for: an empty filter would bring every planned change.
    if (key) void service.load(workspaceId, key.split(','))
  }, [service, workspaceId, key])

  if (!key || planned.length === 0) return null

  return (
    <Alert tone="info" title="Planned: accepted, waiting for its code">
      <Stack gap={1}>
        {planned.map(({ proposal, delta }) => (
          <Inline key={delta.id} gap={1} wrap>
            <TextLink href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.key}</TextLink>
            <Text size="sm">{`${VERB[delta.operation]} ${delta.targetLabel} · ${proposal.title}`}</Text>
          </Inline>
        ))}
        {hasMore && <Inline><Button size="sm" variant="ghost" onClick={() => void service.planned.loadMore()}>Load more</Button></Inline>}
      </Stack>
    </Alert>
  )
}
