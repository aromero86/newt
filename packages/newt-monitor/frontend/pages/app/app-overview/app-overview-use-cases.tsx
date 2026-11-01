import { useEffect, useState } from 'react'
import { PlayIcon } from 'lucide-react'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { ChartPanel } from '@newt-kit/react-ui/chart-panel'
import { Grid } from '@newt-kit/react-ui/grid'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { LineChart } from '@newt-kit/react-ui/line-chart'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { Stat } from '@newt-kit/react-ui/stat'
import { useService } from '@newt-kit/react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsWindow } from '../../../api/event-metrics'
import { UseCaseErrorsApi, type ErrorsSeriesDTO } from '../../../api/use-case-errors'
import { UseCaseMetricsApi, type UseCaseSeriesDTO } from '../../../api/use-case-metrics'
import { BUCKET_LABELS, formatMs, timeFormat, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { marksOn, useAppMarks } from '../app-metrics/chart-marks'

/**
 * Every use case of the application at once: how many calls, how many ran again after a
 * conflict, ended in an error or in a failure, and how long they took on average, in a
 * window. One chart, its lines shown or hidden from its legend; the time on its own axis.
 */
export function AppOverviewUseCases({ app }: { app: AppDTO }) {
  const metrics = useService(UseCaseMetricsApi)
  const errors = useService(UseCaseErrorsApi)
  const marks = useAppMarks()
  const [window, setWindow] = useState<MetricsWindow>('24h')
  const [calls, setCalls] = useState<UseCaseSeriesDTO | null>(null)
  const [ended, setEnded] = useState<ErrorsSeriesDTO | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    // Another window may be asked for before this answers.
    let live = true
    setCalls(null)
    setEnded(null)
    Promise.all([metrics.series(app.id, { window, compare: 'none' }), errors.series(app.id, { window })])
      .then(([series, endedSeries]) => {
        if (!live) return
        setCalls(series)
        setEnded(endedSeries)
        setFailure(null)
      })
      .catch(error => { if (live) setFailure(error instanceof Error ? error.message : 'Could not load the use cases\' metrics') })
    return () => { live = false }
  }, [metrics, errors, app.id, window])

  const endedAt = new Map(ended?.points.map(point => [point.at, point]) ?? [])
  const format = calls ? timeFormat(window, calls.bucket) : undefined

  return (
    <Stack gap={4}>
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => setWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
      </Inline>
      {failure && <Alert tone="bad" title="Could not load the use cases' metrics">{failure}</Alert>}
      {calls && ended
        ? (
            <>
              <Grid columns={{ base: 2, md: 5 }}>
                <Stat label={`Calls, ${WINDOW_LABELS[window]}`} value={calls.total.calls} hint="of every use case" />
                <Stat label="Ran again" value={calls.total.retries} hint="after a conflict" />
                <Stat label="Errors" value={ended.total.errors} hint="they say may happen" />
                <Stat label="Failures" value={ended.total.failures} hint="nobody expected" />
                <Stat label="Mean time" value={formatMs(calls.total.meanMs)} hint={`p90 ${formatMs(calls.total.p90)}`} />
              </Grid>
              <ChartPanel title={<><Icon icon={PlayIcon} tone="ok" /> Every use case, every {BUCKET_LABELS[calls.bucket]}</>}>
                <LineChart
                  label="Every use case: calls, ran again, errors and failures, and their mean time"
                  times={calls.points.map(point => point.at)}
                  marks={marksOn(calls.points.map(point => point.at), marks)}
                  formatTime={format}
                  formatRight={value => formatMs(value)}
                  series={[
                    { key: 'calls', label: 'Calls', tone: 'brand', values: calls.points.map(point => point.calls) },
                    { key: 'retries', label: 'Ran again', tone: 'muted', values: calls.points.map(point => point.retries) },
                    { key: 'errors', label: 'Errors', tone: 'warn', values: calls.points.map(point => endedAt.get(point.at)?.errors ?? 0) },
                    { key: 'failures', label: 'Failures', tone: 'bad', values: calls.points.map(point => endedAt.get(point.at)?.failures ?? 0) },
                    { key: 'mean', label: 'Mean time', tone: 'ok', dashed: true, axis: 'right', values: calls.points.map(point => point.meanMs) },
                  ]}
                />
              </ChartPanel>
            </>
          )
        : !failure && <Skeleton lines={6} />}
    </Stack>
  )
}
