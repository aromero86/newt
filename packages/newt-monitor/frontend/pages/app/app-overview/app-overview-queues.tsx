import { useEffect, useState } from 'react'
import { ListOrderedIcon } from 'lucide-react'
import { Badge } from 'newt-kit-react-ui/badge'
import { Box, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-kit-react-ui/box'
import { Icon } from 'newt-kit-react-ui/icon'
import { TextLink } from 'newt-kit-react-ui/link'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Mono, Text } from 'newt-kit-react-ui/text'
import { useService } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { OutboxApi, type OutboxNowDTO } from '../../../api/outbox'
import { formatMs } from '../app-metrics/metrics-format'

/** Its queues at a glance: how many jobs wait, which queue waits longest, and those nobody serves or that died. Nothing when it has none. */
export function AppOverviewQueues({ app }: { app: AppDTO }) {
  const api = useService(OutboxApi)
  const [current, setCurrent] = useState<OutboxNowDTO | null>(null)

  useEffect(() => {
    api.current(app.id).then(setCurrent).catch(() => setCurrent({ at: null, queues: [] }))
  }, [api, app.id])

  if (current === null) return <Skeleton lines={2} />
  if (current.queues.length === 0) return null
  const waiting = current.queues.reduce((sum, queue) => sum + queue.ready + queue.retrying, 0)
  const dead = current.queues.reduce((sum, queue) => sum + queue.dead, 0)
  const orphans = current.queues.filter(queue => queue.orphan)
  const longest = current.queues.filter(queue => queue.oldestWaitMs != null).sort((a, b) => b.oldestWaitMs! - a.oldestWaitMs!)[0]
  const href = (queue: { context: string, queue: string }) => `/apps/${app.id}/queues/${queue.context}/${queue.queue}`

  return (
    <Box label="Queues">
      <BoxHeader actions={<TextLink href={`/apps/${app.id}/queues`}>Every queue</TextLink>}><Icon icon={ListOrderedIcon} tone="muted" /> Queues now</BoxHeader>
      <BoxRow
        leading={<Icon icon={ListOrderedIcon} tone={orphans.length || dead ? 'bad' : 'ok'} />}
        trailing={(
          <>
            {orphans.length > 0 && <Badge tone="bad">{orphans.length} orphan</Badge>}
            {dead > 0 && <Badge tone="bad">{dead.toLocaleString('en')} dead</Badge>}
          </>
        )}
      >
        <BoxRowTitle>{waiting.toLocaleString('en')} jobs waiting, in {current.queues.length} queues</BoxRowTitle>
        <BoxRowMeta>
          {longest ? <>longest wait {formatMs(longest.oldestWaitMs)}, in <TextLink href={href(longest)}><Mono>{longest.queue}</Mono></TextLink></> : <>none waiting past its time</>}
          {orphans.length > 0 && <>no worker serves {orphans.map(queue => queue.queue).join(', ')}</>}
        </BoxRowMeta>
      </BoxRow>
      {orphans.length === 0 && dead === 0 && waiting === 0 && <BoxRow><Text size="sm" tone="muted">Every job has run.</Text></BoxRow>}
    </Box>
  )
}
