import { useEffect } from 'react'
import { useParams } from 'react-router'
import { UserIcon, XIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Grid } from 'newt-react-ui/grid'
import { Icon } from 'newt-react-ui/icon'
import { Inline } from 'newt-react-ui/inline'
import { LineChart } from 'newt-react-ui/line-chart'
import { TextLink } from 'newt-react-ui/link'
import { Select } from 'newt-react-ui/select'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { Subhead } from 'newt-react-ui/subhead'
import { Mono, Text } from 'newt-react-ui/text'
import { TimeSeries } from 'newt-react-ui/time-series'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import type { LatencyDTO } from '../../../api/use-case-metrics'
import { BUCKET_LABELS, changeOf, formatMs, timeFormat, when, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'
import { findModule, moduleHref } from '../app-structure'
import { AppUseCaseService, type Compare } from './app-use-case.service'

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
  const tops = useValue(service.tops)
  const failure = useValue(service.failure)

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
  const stats = [
    stat('Calls', latency => latency.calls, value => (value ?? 0).toLocaleString('en')),
    stat('Mean', latency => latency.meanMs, formatMs),
    stat('p90', latency => latency.p90, formatMs),
    stat('p99', latency => latency.p99, formatMs),
  ]

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
                {stats.map(each => (
                  <Stat key={each.label} label={each.label === 'Calls' ? `Calls in ${WINDOW_LABELS[window]}` : each.label} value={each.label === 'Calls' ? each.value ?? 0 : each.show(each.value)} hint={each.hint} />
                ))}
              </Grid>
              {series.total.retries > 0 && (
                <Alert tone="warn" title={`${series.total.retries.toLocaleString('en')} runs more after a conflict`}>
                  Its calls ran again, together, that many times: someone saved what they had read meanwhile.
                </Alert>
              )}
              <Box label="How long">
                <BoxHeader>How long, every {BUCKET_LABELS[bucket]}, {when(series.from)} to {when(series.to)}</BoxHeader>
                <BoxRow>
                  <LineChart
                    label={`${useCase}: mean, p50, p90 and p99, every ${BUCKET_LABELS[bucket]}`}
                    times={series.points.map(point => point.at)}
                    formatTime={format}
                    formatValue={value => formatMs(value)}
                    series={[
                      { key: 'p50', label: 'p50', tone: 'ok', values: series.points.map(point => point.p50) },
                      { key: 'p90', label: 'p90', tone: 'warn', values: series.points.map(point => point.p90) },
                      { key: 'p99', label: 'p99', tone: 'bad', values: series.points.map(point => point.p99) },
                      { key: 'mean', label: 'Mean', tone: 'brand', dashed: true, values: series.points.map(point => point.meanMs) },
                    ]}
                  />
                </BoxRow>
              </Box>
              <Box label="Calls">
                <BoxHeader>Calls, every {BUCKET_LABELS[bucket]}</BoxHeader>
                <BoxRow>
                  <TimeSeries
                    label={`${useCase}: calls, every ${BUCKET_LABELS[bucket]}`}
                    points={series.points.map(point => ({ at: point.at, count: point.calls }))}
                    compared={series.compared?.map(point => ({ at: point.at, count: point.calls })) ?? null}
                    names={{ points: `Last ${WINDOW_LABELS[window]}`, compared: compare === 'week' ? 'A week before' : 'The window before' }}
                    formatTime={format}
                  />
                </BoxRow>
              </Box>
            </>
          )
        : <Skeleton lines={6} />}
      <Grid columns={{ base: 1, md: 2 }}>
        {tops.map(({ by, top }) => (
          <Box key={by} label={by === 'actor' ? 'Who calls it most' : `Its ${by.slice(6)}s`}>
            <BoxHeader>{by === 'actor' ? 'Who calls it most' : <>By {by.slice(6)}</>}</BoxHeader>
            {top.length === 0 && <BoxEmpty icon={UserIcon} title="Nobody in this window" />}
            {top.map(row => (
              <BoxRow key={row.value ?? 'none'} trailing={<Text size="sm" tone="muted">{row.calls.toLocaleString('en')} calls</Text>}>
                {row.value === null
                  ? <Text size="sm" tone="muted">{by === 'actor' ? 'No one (a worker, a schedule)' : 'Outside any'}</Text>
                  : <Button size="sm" variant="link" onClick={() => void service.filter(by === 'actor' ? { actor: row.value } : { scope: `${by.slice(6)}:${row.value}` })}><Mono>{row.value}</Mono></Button>}
                <BoxRowMeta>
                  <>p50 {formatMs(row.p50)}</>
                  <>p90 {formatMs(row.p90)}</>
                  <>p99 {formatMs(row.p99)}</>
                </BoxRowMeta>
              </BoxRow>
            ))}
          </Box>
        ))}
      </Grid>
    </Stack>
  )
}
