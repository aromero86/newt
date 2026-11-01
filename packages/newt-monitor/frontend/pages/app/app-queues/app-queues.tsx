import { useEffect, useState } from 'react'
import { BlocksIcon, InboxIcon, ListOrderedIcon, SearchXIcon } from 'lucide-react'
import { Badge } from 'newt-kit-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-kit-react-ui/box'
import { Counter } from 'newt-kit-react-ui/counter'
import { Icon } from 'newt-kit-react-ui/icon'
import { Inline } from 'newt-kit-react-ui/inline'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Stack } from 'newt-kit-react-ui/stack'
import { SearchField } from 'newt-kit-react-ui/search-field'
import { Mono, Text } from 'newt-kit-react-ui/text'
import { useService } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { OutboxApi, type OutboxNowDTO, type OutboxQueueDTO } from '../../../api/outbox'
import { QueueMetricsApi, type QueueTotalDTO } from '../../../api/queue-metrics'
import { formatMs, handlerOf } from '../app-metrics/metrics-format'
import { matches } from '../app-structure'
import { AppQueuesAll } from './app-queues-all'

/**
 * The Queues tab: every queue of the application together, over a window, as one queue's
 * page shows one; then each queue, by context, found by a search, how full it is now and
 * how it flowed in 24 hours.
 */
export function AppQueues({ app }: { app: AppDTO }) {
  const outboxApi = useService(OutboxApi)
  const queueApi = useService(QueueMetricsApi)
  const [current, setCurrent] = useState<OutboxNowDTO | null>(null)
  const [totals, setTotals] = useState<Map<string, QueueTotalDTO> | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    outboxApi.current(app.id).then(setCurrent).catch(() => setCurrent({ at: null, queues: [] }))
    queueApi.totals(app.id, '24h').then(found => setTotals(new Map(found.map(total => [`${total.context}|${total.queue}`, total])))).catch(() => setTotals(new Map()))
  }, [outboxApi, queueApi, app.id])

  if (!current || !totals) return <Skeleton lines={6} />
  // Those of the last snapshot, and any that flowed in 24 hours but has no job now.
  const byContext = new Map<string, Map<string, OutboxQueueDTO | null>>()
  for (const queue of current.queues) byContext.set(queue.context, (byContext.get(queue.context) ?? new Map()).set(queue.queue, queue))
  for (const total of totals.values()) {
    const queues = byContext.get(total.context) ?? new Map()
    if (!queues.has(total.queue)) queues.set(total.queue, null)
    byContext.set(total.context, queues)
  }
  if (byContext.size === 0) {
    return (
      <Box label="Queues">
        <BoxEmpty icon={InboxIcon} title="No queues yet" description="A queue appears once a worker subscribes to an event, or a job flows through it." />
      </Box>
    )
  }

  const found = [...byContext]
    .map(([context, queues]) => [context, new Map([...queues].filter(([name]) => matches(`${context} ${name}`, search)))] as const)
    .filter(([, queues]) => queues.size > 0)

  return (
    <Stack gap={4}>
      <AppQueuesAll app={app} current={current} />
      <SearchField live label="Search queues" placeholder="Search queues: card index" onSearch={setSearch} />
      {found.length === 0 && (
        <Box label="Queues">
          <BoxEmpty icon={SearchXIcon} title="No queue matches" description="Every word is looked for in its context and its name." />
        </Box>
      )}
      {found.sort(([a], [b]) => a.localeCompare(b)).map(([context, queues]) => (
        <Box key={context} label={`Queues of ${context}`}>
          <BoxHeader><Icon icon={BlocksIcon} tone="muted" /> {context} <Counter>{queues.size}</Counter></BoxHeader>
          {[...queues].sort(([a], [b]) => a.localeCompare(b)).map(([name, queue]) => {
            const total = totals.get(`${context}|${name}`)
            return (
              <BoxRow
                key={name}
                leading={<Icon icon={ListOrderedIcon} tone={queue?.orphan ? 'bad' : 'muted'} />}
                trailing={(
                  <Inline gap={2}>
                    {queue?.orphan && <Badge tone="bad">Orphan</Badge>}
                    {queue && queue.dead > 0 && <Badge tone="bad">{queue.dead} dead</Badge>}
                    <Text size="sm" tone="muted">{queue ? `${(queue.ready + queue.retrying).toLocaleString('en')} waiting` : 'empty'}</Text>
                  </Inline>
                )}
              >
                <BoxRowTitle href={`/apps/${app.id}/queues/${context}/${name}`}><Mono>{name}</Mono></BoxRowTitle>
                <BoxRowMeta>
                  <>runs <Mono>{handlerOf(name)}</Mono></>
                  {total && <>{total.now.published.toLocaleString('en')} in, {total.now.delivered.toLocaleString('en')} out in 24h</>}
                  {total?.now.waitP90 != null && <>p90 wait {formatMs(total.now.waitP90)}</>}
                  {queue && queue.running > 0 && <>{queue.running} running</>}
                  {queue?.oldestWaitMs != null && <>oldest waiting {formatMs(queue.oldestWaitMs)}</>}
                </BoxRowMeta>
              </BoxRow>
            )
          })}
        </Box>
      ))}
    </Stack>
  )
}
