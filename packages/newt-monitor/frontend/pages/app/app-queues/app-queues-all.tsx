import { useEffect, useState } from 'react'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { Grid } from '@newt-kit/react-ui/grid'
import { Inline } from '@newt-kit/react-ui/inline'
import { Select } from '@newt-kit/react-ui/select'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stat } from '@newt-kit/react-ui/stat'
import { useService } from '@newt-kit/react'
import type { AppDTO } from '../../../api/app'
import { DEFAULT_BUCKET, WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { OutboxApi, type DepthSeriesDTO, type OutboxNowDTO } from '../../../api/outbox'
import { QueueMetricsApi, type QueueSeriesDTO } from '../../../api/queue-metrics'
import { BUCKET_LABELS, formatMs, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { QueueCharts } from '../app-queue/queue-charts'

type Compare = 'previous' | 'week' | 'none'

/** Every queue of the application as one: how full they are now, summed, and how they went over a window, as one queue's page shows it. */
export function AppQueuesAll({ app, current }: { app: AppDTO, current: OutboxNowDTO }) {
  const queueApi = useService(QueueMetricsApi)
  const outboxApi = useService(OutboxApi)
  const [window, setWindow] = useState<MetricsWindow>('24h')
  const [bucket, setBucket] = useState<MetricsBucket>(DEFAULT_BUCKET['24h'])
  const [compare, setCompare] = useState<Compare>('previous')
  const [flow, setFlow] = useState<QueueSeriesDTO | null>(null)
  const [depth, setDepth] = useState<DepthSeriesDTO | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    // Another window, bucket or comparison may be asked for before this answers.
    let live = true
    setFlow(null)
    setDepth(null)
    Promise.all([queueApi.series(app.id, { window, bucket, compare }), outboxApi.depth(app.id, { window, bucket })])
      .then(([flowSeries, depthSeries]) => {
        if (!live) return
        setFlow(flowSeries)
        setDepth(depthSeries)
        setFailure(null)
      })
      .catch(error => { if (live) setFailure(error instanceof Error ? error.message : 'Could not load the queues\' metrics') })
    return () => { live = false }
  }, [queueApi, outboxApi, app.id, window, bucket, compare])

  const sum = (pick: (queue: OutboxNowDTO['queues'][number]) => number) => current.queues.reduce((total, queue) => total + pick(queue), 0)
  const oldest = Math.max(0, ...current.queues.map(queue => queue.oldestWaitMs ?? 0))

  return (
    <>
      <Grid columns={{ base: 2, md: 4 }}>
        <Stat label="Waiting now" value={sum(queue => queue.ready + queue.retrying)} hint={`${sum(queue => queue.ready)} ready, ${sum(queue => queue.retrying)} to run again, in ${current.queues.length} queues`} />
        <Stat label="Running now" value={sum(queue => queue.running)} hint="taken by a worker, not closed" />
        <Stat label="Dead now" value={sum(queue => queue.dead)} hint="out of attempts" />
        <Stat label="Oldest waiting" value={formatMs(oldest || null)} hint="in any queue" />
      </Grid>
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => { setWindow(each); setBucket(DEFAULT_BUCKET[each]) }}>{WINDOW_LABELS[each]}</Button>
        ))}
      </Inline>
      <Inline gap={2} wrap>
        <Select size="compact" label="Bucket" value={bucket} onValueChange={value => setBucket(value as MetricsBucket)} options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))} />
        <Select size="compact" label="Compare with" value={compare} onValueChange={value => setCompare(value as Compare)} options={[{ value: 'previous', label: 'Compared with the window before' }, { value: 'week', label: 'Compared with a week before' }, { value: 'none', label: 'Not compared' }]} />
      </Inline>
      {failure && <Alert tone="bad" title="Could not load the queues' metrics">{failure}</Alert>}
      {flow && depth ? <QueueCharts name="Every queue" flow={flow} depth={depth} window={window} bucket={bucket} compare={compare} /> : !failure && <Skeleton lines={6} />}
    </>
  )
}
