import { useEffect } from 'react'
import { useParams } from 'react-router'
import { SkullIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Grid } from 'newt-react-ui/grid'
import { Inline } from 'newt-react-ui/inline'
import { LineChart } from 'newt-react-ui/line-chart'
import { TextLink } from 'newt-react-ui/link'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Select } from 'newt-react-ui/select'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { Subhead } from 'newt-react-ui/subhead'
import { Mono, Text } from 'newt-react-ui/text'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { BUCKET_LABELS, changeOf, formatMs, handlerOf, timeFormat, when, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { TraceList } from '../app-traces/trace-list'
import { AppQueueService, type Compare } from './app-queue.service'

/** One queue: how full it is and was, what went in and out, how long its jobs waited, and its dead jobs. With its own AppQueueService. */
export function AppQueue({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppQueueService]}>
      <AppQueueWrapped app={app} />
    </Provide>
  )
}

function AppQueueWrapped({ app }: { app: AppDTO }) {
  const { context, queue } = useParams() as { context: string, queue: string }
  const service = useService(AppQueueService)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  const compare = useValue(service.compare)
  const current = useValue(service.current)
  const flow = useValue(service.flow)
  const depth = useValue(service.depth)
  const failure = useValue(service.failure)

  useEffect(() => {
    void service.open(context, queue)
  }, [service, context, queue])

  const format = timeFormat(window, bucket)
  const handler = handlerOf(queue)
  const before = compare === 'week' ? 'a week before' : 'the window before'
  const hint = (now: number, was: number | undefined) => (flow?.comparedTotal && was !== undefined ? `${was.toLocaleString('en')} ${before}${changeOf(now, was) ? ` (${changeOf(now, was)})` : ''}` : undefined)

  return (
    <Stack gap={4}>
      <Subhead
        title={<Mono>{queue}</Mono>}
        description={<>A queue of {context}, run by <TextLink href={`/apps/${app.id}/use-cases/${context}/${handler}`}><Mono>{handler}</Mono></TextLink>: how long it takes and how it fails is there.</>}
        actions={current?.orphan ? <Badge tone="bad">Orphan: no worker serves it</Badge> : undefined}
      />
      <Grid columns={{ base: 2, md: 4 }}>
        <Stat label="Waiting now" value={current ? current.ready + current.retrying : 0} hint={current ? `${current.ready} ready, ${current.retrying} to run again` : 'no job'} />
        <Stat label="Running now" value={current?.running ?? 0} hint="taken by a worker, not closed" />
        <Stat label="Dead now" value={current?.dead ?? 0} hint="out of attempts" />
        <Stat label="Oldest waiting" value={formatMs(current?.oldestWaitMs ?? null)} hint="since it was due" />
      </Grid>
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => void service.showWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
      </Inline>
      <Inline gap={2} wrap>
        <Select size="compact" label="Bucket" value={bucket} onValueChange={value => void service.showBucket(value as MetricsBucket)} options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))} />
        <Select size="compact" label="Compare with" value={compare} onValueChange={value => void service.compareWith(value as Compare)} options={[{ value: 'previous', label: 'Compared with the window before' }, { value: 'week', label: 'Compared with a week before' }, { value: 'none', label: 'Not compared' }]} />
      </Inline>
      {failure && <Alert tone="bad" title="Could not load the queue">{failure}</Alert>}
      {flow && depth
        ? (
            <>
              <Grid columns={{ base: 2, md: 4 }}>
                <Stat label={`In, ${WINDOW_LABELS[window]}`} value={flow.total.published} hint={hint(flow.total.published, flow.comparedTotal?.published)} />
                <Stat label="Out" value={flow.total.delivered} hint={hint(flow.total.delivered, flow.comparedTotal?.delivered)} />
                <Stat label="Run again, and dead" value={`${flow.total.redelivered.toLocaleString('en')} · ${flow.total.dead.toLocaleString('en')}`} hint={flow.comparedTotal ? `${flow.comparedTotal.redelivered} · ${flow.comparedTotal.dead} ${before}` : undefined} />
                <Stat label="Wait p90" value={formatMs(flow.total.waitP90)} hint={flow.comparedTotal ? `${formatMs(flow.comparedTotal.waitP90)} ${before}` : undefined} />
              </Grid>
              <Box label="How full">
                <BoxHeader>How full, every {BUCKET_LABELS[bucket]} (the most it reached), {when(depth.from)} to {when(depth.to)}</BoxHeader>
                <BoxRow>
                  <LineChart
                    label={`${queue}: jobs ready, to run again, running and dead`}
                    times={depth.points.map(point => point.at)}
                    formatTime={format}
                    series={[
                      { key: 'ready', label: 'Ready', tone: 'brand', values: depth.points.map(point => point.ready) },
                      { key: 'retrying', label: 'To run again', tone: 'warn', values: depth.points.map(point => point.retrying) },
                      { key: 'running', label: 'Running', tone: 'ok', values: depth.points.map(point => point.running) },
                      { key: 'dead', label: 'Dead', tone: 'bad', values: depth.points.map(point => point.dead) },
                    ]}
                  />
                </BoxRow>
              </Box>
              <Box label="In and out">
                <BoxHeader>In and out, every {BUCKET_LABELS[bucket]}</BoxHeader>
                <BoxRow>
                  <LineChart
                    label={`${queue}: jobs in, out, run again and dead`}
                    times={flow.points.map(point => point.at)}
                    formatTime={format}
                    series={[
                      { key: 'published', label: 'In', tone: 'brand', values: flow.points.map(point => point.published) },
                      { key: 'delivered', label: 'Out', tone: 'ok', values: flow.points.map(point => point.delivered) },
                      { key: 'redelivered', label: 'Run again', tone: 'warn', values: flow.points.map(point => point.redelivered) },
                      { key: 'dead', label: 'Dead', tone: 'bad', values: flow.points.map(point => point.dead) },
                    ]}
                  />
                </BoxRow>
              </Box>
              <Box label="Wait">
                <BoxHeader>How long jobs waited before a worker took them, every {BUCKET_LABELS[bucket]}</BoxHeader>
                <BoxRow>
                  <LineChart
                    label={`${queue}: wait p50, p90 and p99`}
                    times={flow.points.map(point => point.at)}
                    formatTime={format}
                    formatValue={value => formatMs(value)}
                    series={[
                      { key: 'p50', label: 'p50', tone: 'ok', values: flow.points.map(point => point.waitP50) },
                      { key: 'p90', label: 'p90', tone: 'warn', values: flow.points.map(point => point.waitP90) },
                      { key: 'p99', label: 'p99', tone: 'bad', values: flow.points.map(point => point.waitP99) },
                    ]}
                  />
                </BoxRow>
              </Box>
            </>
          )
        : <Skeleton lines={6} />}
      <AppQueueDead appId={app.id} />
      <TraceList appId={app.id} title="Runs" query={{ queue }} window={window} />
    </Stack>
  )
}

/** Its dead jobs, as the application lists them: which event, how many attempts, why. Never their payloads. */
function AppQueueDead({ appId }: { appId: string }) {
  const service = useService(AppQueueService)
  const dead = useValue(service.dead)
  const more = useValue(service.moreDead)
  const failure = useValue(service.deadFailure)

  return (
    <Box label="Dead jobs">
      <BoxHeader>Dead jobs: out of attempts, waiting for someone</BoxHeader>
      {failure && <BoxRow><Alert tone="bad" title="Could not ask for its dead jobs">{failure}</Alert></BoxRow>}
      {!failure && dead.length === 0 && <BoxEmpty icon={SkullIcon} title="None" description="Every job of this queue ran, or is still to run." />}
      {dead.map(job => (
        <BoxRow key={job.id} leading={<Badge tone="bad">Dead</Badge>} trailing={<Text size="sm" tone="muted">{job.attempts} attempts</Text>}>
          <BoxRowTitle href={`/apps/${appId}/jobs/${job.id}`}><Mono>{job.event}</Mono></BoxRowTitle>
          <BoxRowMeta>
            <>died <RelativeTime date={job.diedAt} /></>
            <>published <RelativeTime date={job.createdAt} /></>
            <><Mono>{(job.lastError ?? 'no error said').split('\n')[0]}</Mono></>
          </BoxRowMeta>
        </BoxRow>
      ))}
      {more && (
        <BoxFooter>
          <Button size="sm" variant="outline" onClick={() => void service.loadDead()}>More</Button>
        </BoxFooter>
      )}
    </Box>
  )
}
