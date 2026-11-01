import { useEffect } from 'react'
import { useParams } from 'react-router'
import { XIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Button } from 'newt-kit-react-ui/button'
import { ChartPanel, ChartRow } from 'newt-kit-react-ui/chart-panel'
import { Grid } from 'newt-kit-react-ui/grid'
import { Icon } from 'newt-kit-react-ui/icon'
import { Inline } from 'newt-kit-react-ui/inline'
import { LineChart } from 'newt-kit-react-ui/line-chart'
import { TextLink } from 'newt-kit-react-ui/link'
import { Select } from 'newt-kit-react-ui/select'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Stack } from 'newt-kit-react-ui/stack'
import { Stat } from 'newt-kit-react-ui/stat'
import { Subhead } from 'newt-kit-react-ui/subhead'
import { Mono } from 'newt-kit-react-ui/text'
import { TimeSeries } from 'newt-kit-react-ui/time-series'
import { Provide, useService, useValue } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import type { LatencyDTO } from '../../../api/use-case-metrics'
import { BUCKET_LABELS, changeOf, formatMs, timeFormat, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'
import { findModule, moduleHref } from '../app-structure'
import { AppUseCaseErrors } from './app-use-case-errors'
import { AppUseCaseTops } from './app-use-case-tops'
import { AppUseCaseTraces } from './app-use-case-traces'
import { AppUseCaseService, type Compare } from './app-use-case.service'
import { marksOn, useAppMarks } from '../app-metrics/chart-marks'

/** One use case: how its calls went over a window, beside the one before; and who calls it most. With its own AppUseCaseService. */
export function AppUseCase({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppUseCaseService]}>
      <AppUseCaseWrapped app={app} />
    </Provide>
  )
}

function AppUseCaseWrapped({ app }: { app: AppDTO }) {
  const { context, useCase } = useParams() as { context: string, useCase: string }
  const service = useService(AppUseCaseService)
  const structure = useValue(useService(AppService).structure)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  const compare = useValue(service.compare)
  const scope = useValue(service.scope)
  const actor = useValue(service.actor)
  const series = useValue(service.series)
  const errors = useValue(service.errors)
  const failure = useValue(service.failure)
  const marks = useAppMarks()

  useEffect(() => {
    void service.open(context, useCase)
  }, [service, context, useCase])

  const module = structure ? findModule(structure.description, context, useCase.split('.')[0]!) : undefined
  const format = timeFormat(window, bucket)
  const before = compare === 'week' ? 'a week before' : 'the window before'
  const stat = (label: string, pick: (latency: LatencyDTO) => number | null, show: (value: number | null) => string) => {
    const value = series ? pick(series.total) : null
    const was = series?.comparedTotal ? pick(series.comparedTotal) : null
    const change = changeOf(value, was)
    return { label, value, hint: series?.comparedTotal ? `${show(was)} ${before}${change ? ` (${change})` : ''}` : undefined, show }
  }
  const rate = (latency: LatencyDTO) => (latency.calls ? (latency.retries / latency.calls) * 100 : null)
  const ratePer100 = (latency: LatencyDTO | null | undefined) => (latency && rate(latency) !== null ? `${rate(latency)!.toLocaleString('en', { maximumFractionDigits: 1 })} per 100 calls` : 'no calls')
  const retriesHint = series ? `${ratePer100(series.total)}${series.comparedTotal ? `; ${series.comparedTotal.retries.toLocaleString('en')} ${before}${changeOf(series.total.retries, series.comparedTotal.retries) ? ` (${changeOf(series.total.retries, series.comparedTotal.retries)})` : ''}` : ''}` : undefined
  const per100 = (count: number) => (series?.total.calls ? `${((count / series.total.calls) * 100).toLocaleString('en', { maximumFractionDigits: 1 })} per 100 calls` : 'no calls')
  const volume = [
    { label: `Calls in ${WINDOW_LABELS[window]}`, value: series?.total.calls ?? 0, hint: stat('Calls', latency => latency.calls, value => (value ?? 0).toLocaleString('en')).hint },
    { label: 'Runs more after a conflict', value: series?.total.retries ?? 0, hint: retriesHint },
    { label: 'Errors', value: errors?.total.errors ?? 0, hint: `${per100(errors?.total.errors ?? 0)}: they say they may happen` },
    { label: 'Failures', value: errors?.total.failures ?? 0, hint: `${per100(errors?.total.failures ?? 0)}: nobody expected them` },
  ]
  const time = [stat('Mean', latency => latency.meanMs, formatMs), stat('p90', latency => latency.p90, formatMs), stat('p99', latency => latency.p99, formatMs)]

  return (
    <Stack gap={4}>
      <Subhead
        title={<Mono>{useCase}</Mono>}
        description={module ? <>A use case of <TextLink href={moduleHref(app.id, module.id)}>{module.id}</TextLink></> : <>Of {context}</>}
      />
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => void service.showWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
      </Inline>
      <Inline gap={2} wrap>
        <Select size="compact" label="Bucket" value={bucket} onValueChange={value => void service.showBucket(value as MetricsBucket)} options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))} />
        <Select size="compact" label="Compare with" value={compare} onValueChange={value => void service.compareWith(value as Compare)} options={[{ value: 'previous', label: 'Compared with the window before' }, { value: 'week', label: 'Compared with a week before' }, { value: 'none', label: 'Not compared' }]} />
        {actor && <Button size="sm" variant="outline" onClick={() => void service.filter({ actor: null })}>actor: {actor}<Icon icon={XIcon} size="sm" /></Button>}
        {scope && <Button size="sm" variant="outline" onClick={() => void service.filter({ scope: null })}>{scope}<Icon icon={XIcon} size="sm" /></Button>}
      </Inline>
      {failure && <Alert tone="bad" title="Could not load its metrics">{failure}</Alert>}
      {series
        ? (
            <>
              <Grid columns={{ base: 2, md: 4 }}>
                {volume.map(each => <Stat key={each.label} label={each.label} value={each.value} hint={each.hint} />)}
              </Grid>
              <Grid columns={{ base: 1, md: 3 }}>
                {time.map(each => <Stat key={each.label} label={each.label} value={each.show(each.value)} hint={each.hint} />)}
              </Grid>
              <ChartRow>
                <ChartPanel title={<>How long, every {BUCKET_LABELS[bucket]}</>}>
                  <LineChart
                    label={`${useCase}: mean, p50, p90 and p99, every ${BUCKET_LABELS[bucket]}`}
                    times={series.points.map(point => point.at)}
                    marks={marksOn(series.points.map(point => point.at), marks)}
                    formatTime={format}
                    formatValue={value => formatMs(value)}
                    series={[
                      { key: 'p50', label: 'p50', tone: 'ok', values: series.points.map(point => point.p50) },
                      { key: 'p90', label: 'p90', tone: 'warn', values: series.points.map(point => point.p90) },
                      { key: 'p99', label: 'p99', tone: 'bad', values: series.points.map(point => point.p99) },
                      { key: 'mean', label: 'Mean', tone: 'brand', dashed: true, values: series.points.map(point => point.meanMs) },
                    ]}
                  />
                </ChartPanel>
                <ChartPanel title={<>Calls, every {BUCKET_LABELS[bucket]}</>}>
                  <TimeSeries
                    label={`${useCase}: calls, every ${BUCKET_LABELS[bucket]}`}
                    points={series.points.map(point => ({ at: point.at, count: point.calls }))}
                    marks={marksOn(series.points.map(point => point.at), marks)}
                    compared={series.compared?.map(point => ({ at: point.at, count: point.calls })) ?? null}
                    names={{ points: `Last ${WINDOW_LABELS[window]}`, compared: compare === 'week' ? 'A week before' : 'The window before' }}
                    formatTime={format}
                  />
                </ChartPanel>
                <ChartPanel title={<>Runs more after a conflict, every {BUCKET_LABELS[bucket]}</>}>
                  <TimeSeries
                    label={`${useCase}: runs more after a conflict, every ${BUCKET_LABELS[bucket]}`}
                    points={series.points.map(point => ({ at: point.at, count: point.retries }))}
                    marks={marksOn(series.points.map(point => point.at), marks)}
                    compared={series.compared?.map(point => ({ at: point.at, count: point.retries })) ?? null}
                    names={{ points: `Last ${WINDOW_LABELS[window]}`, compared: compare === 'week' ? 'A week before' : 'The window before' }}
                    formatTime={format}
                  />
                </ChartPanel>
                {errors && (
                  <ChartPanel title={<>How its calls ended badly, every {BUCKET_LABELS[bucket]}</>}>
                    <LineChart
                      label={`${useCase}: errors and failures, every ${BUCKET_LABELS[bucket]}`}
                      times={errors.points.map(point => point.at)}
                      marks={marksOn(errors.points.map(point => point.at), marks)}
                      formatTime={format}
                      series={[
                        { key: 'errors', label: 'Errors', tone: 'warn', values: errors.points.map(point => point.errors) },
                        { key: 'failures', label: 'Failures', tone: 'bad', values: errors.points.map(point => point.failures) },
                      ]}
                    />
                  </ChartPanel>
                )}
              </ChartRow>
              <AppUseCaseErrors />
            </>
          )
        : <Skeleton lines={6} />}
      <AppUseCaseTraces appId={app.id} context={context} useCase={useCase} window={window} total={series?.total ?? null} />
      <AppUseCaseTops />
    </Stack>
  )
}
