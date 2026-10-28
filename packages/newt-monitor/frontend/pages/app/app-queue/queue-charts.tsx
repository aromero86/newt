import { ChartPanel, ChartRow } from 'newt-react-ui/chart-panel'
import { Grid } from 'newt-react-ui/grid'
import { LineChart } from 'newt-react-ui/line-chart'
import { Stat } from 'newt-react-ui/stat'
import type { MetricsBucket, MetricsWindow } from '../../../api/event-metrics'
import type { DepthSeriesDTO } from '../../../api/outbox'
import type { QueueSeriesDTO } from '../../../api/queue-metrics'
import { BUCKET_LABELS, changeOf, formatMs, timeFormat, WINDOW_LABELS } from '../app-metrics/metrics-format'

/**
 * How a queue went over a window, or every queue at once: what went in and out, how
 * full it was, how long its jobs waited. Each chart's lines shown or hidden from its legend.
 */
export function QueueCharts({ name, flow, depth, window, bucket, compare }: { name: string, flow: QueueSeriesDTO, depth: DepthSeriesDTO, window: MetricsWindow, bucket: MetricsBucket, compare: 'previous' | 'week' | 'none' }) {
  const format = timeFormat(window, bucket)
  const before = compare === 'week' ? 'a week before' : 'the window before'
  const hint = (now: number, was: number | undefined) => (flow.comparedTotal && was !== undefined ? `${was.toLocaleString('en')} ${before}${changeOf(now, was) ? ` (${changeOf(now, was)})` : ''}` : undefined)

  return (
    <>
      <Grid columns={{ base: 2, md: 4 }}>
        <Stat label={`In, ${WINDOW_LABELS[window]}`} value={flow.total.published} hint={hint(flow.total.published, flow.comparedTotal?.published)} />
        <Stat label="Out" value={flow.total.delivered} hint={hint(flow.total.delivered, flow.comparedTotal?.delivered)} />
        <Stat label="Run again, and dead" value={`${flow.total.redelivered.toLocaleString('en')} · ${flow.total.dead.toLocaleString('en')}`} hint={flow.comparedTotal ? `${flow.comparedTotal.redelivered} · ${flow.comparedTotal.dead} ${before}` : undefined} />
        <Stat label="Wait p90" value={formatMs(flow.total.waitP90)} hint={flow.comparedTotal ? `${formatMs(flow.comparedTotal.waitP90)} ${before}` : undefined} />
      </Grid>
      <ChartRow>
        <ChartPanel title={<>How full (the most it reached), every {BUCKET_LABELS[bucket]}</>}>
          <LineChart
            label={`${name}: jobs ready, to run again, running and dead`}
            times={depth.points.map(point => point.at)}
            formatTime={format}
            series={[
              { key: 'ready', label: 'Ready', tone: 'brand', values: depth.points.map(point => point.ready) },
              { key: 'retrying', label: 'To run again', tone: 'warn', values: depth.points.map(point => point.retrying) },
              { key: 'running', label: 'Running', tone: 'ok', values: depth.points.map(point => point.running) },
              { key: 'dead', label: 'Dead', tone: 'bad', values: depth.points.map(point => point.dead) },
            ]}
          />
        </ChartPanel>
        <ChartPanel title={<>In and out, every {BUCKET_LABELS[bucket]}</>}>
          <LineChart
            label={`${name}: jobs in, out, run again and dead`}
            times={flow.points.map(point => point.at)}
            formatTime={format}
            series={[
              { key: 'published', label: 'In', tone: 'brand', values: flow.points.map(point => point.published) },
              { key: 'delivered', label: 'Out', tone: 'ok', values: flow.points.map(point => point.delivered) },
              { key: 'redelivered', label: 'Run again', tone: 'warn', values: flow.points.map(point => point.redelivered) },
              { key: 'dead', label: 'Dead', tone: 'bad', values: flow.points.map(point => point.dead) },
            ]}
          />
        </ChartPanel>
        <ChartPanel title={<>How long jobs waited, every {BUCKET_LABELS[bucket]}</>}>
          <LineChart
            label={`${name}: wait p50, p90 and p99`}
            times={flow.points.map(point => point.at)}
            formatTime={format}
            formatValue={value => formatMs(value)}
            series={[
              { key: 'p50', label: 'p50', tone: 'ok', values: flow.points.map(point => point.waitP50) },
              { key: 'p90', label: 'p90', tone: 'warn', values: flow.points.map(point => point.waitP90) },
              { key: 'p99', label: 'p99', tone: 'bad', values: flow.points.map(point => point.waitP99) },
            ]}
          />
        </ChartPanel>
      </ChartRow>
    </>
  )
}
