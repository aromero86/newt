import { useEffect } from 'react'
import { useParams } from 'react-router'
import { UserIcon, XIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Box, BoxEmpty, BoxHeader, BoxRow } from 'newt-kit-react-ui/box'
import { Button } from 'newt-kit-react-ui/button'
import { Grid } from 'newt-kit-react-ui/grid'
import { Icon } from 'newt-kit-react-ui/icon'
import { Inline } from 'newt-kit-react-ui/inline'
import { TextLink } from 'newt-kit-react-ui/link'
import { Select } from 'newt-kit-react-ui/select'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { ChartPanel } from 'newt-kit-react-ui/chart-panel'
import { Stack } from 'newt-kit-react-ui/stack'
import { Stat } from 'newt-kit-react-ui/stat'
import { Subhead } from 'newt-kit-react-ui/subhead'
import { Mono, Text } from 'newt-kit-react-ui/text'
import { TimeSeries } from 'newt-kit-react-ui/time-series'
import { Provide, useService, useValue } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { BUCKET_LABELS, timeFormat, when, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'
import { findModule, moduleHref } from '../app-structure'
import { TraceList } from '../app-traces/trace-list'
import { AppEventLive } from './app-event-live'
import { AppEventService, type Compare } from './app-event.service'
import { marksOn, useAppMarks } from '../app-metrics/chart-marks'

/** One event: how many times it was told, over a window, beside the one before; and who tells it most. With its own AppEventService. */
export function AppEvent({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppEventService]}>
      <AppEventWrapped app={app} />
    </Provide>
  )
}

function AppEventWrapped({ app }: { app: AppDTO }) {
  const { context, event } = useParams() as { context: string, event: string }
  const service = useService(AppEventService)
  const structure = useValue(useService(AppService).structure)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  const compare = useValue(service.compare)
  const scope = useValue(service.scope)
  const actor = useValue(service.actor)
  const series = useValue(service.series)
  const tops = useValue(service.tops)
  const failure = useValue(service.failure)
  const marks = useAppMarks()

  useEffect(() => {
    void service.open(context, event)
  }, [service, context, event])

  const module = structure ? findModule(structure.description, context, event.split('.')[0]!) : undefined
  const format = timeFormat(window, bucket)
  const change = series && series.comparedTotal ? Math.round(((series.total - series.comparedTotal) / series.comparedTotal) * 100) : null
  const comparedName = compare === 'week' ? 'A week before' : 'The window before'

  return (
    <Stack gap={4}>
      <Subhead
        title={<Mono>{event}</Mono>}
        description={module ? <>Told by <TextLink href={moduleHref(app.id, module.id)}>{module.id}</TextLink></> : <>Of {context}</>}
        actions={app.archivedAt ? undefined : <AppEventLive appId={app.id} context={context} event={event} />}
      />
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => void service.showWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
      </Inline>
      <Inline gap={2} wrap>
        <Select
          size="compact"
          label="Bucket"
          value={bucket}
          onValueChange={value => void service.showBucket(value as MetricsBucket)}
          options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))}
        />
        <Select
          size="compact"
          label="Compare with"
          value={compare}
          onValueChange={value => void service.compareWith(value as Compare)}
          options={[{ value: 'previous', label: 'Compared with the window before' }, { value: 'week', label: 'Compared with a week before' }, { value: 'none', label: 'Not compared' }]}
        />
        {actor && <Button size="sm" variant="outline" onClick={() => void service.filter({ actor: null })}>actor: {actor}<Icon icon={XIcon} size="sm" /></Button>}
        {scope && <Button size="sm" variant="outline" onClick={() => void service.filter({ scope: null })}>{scope}<Icon icon={XIcon} size="sm" /></Button>}
      </Inline>
      {failure && <Alert tone="bad" title="Could not load its metrics">{failure}</Alert>}
      {series
        ? (
            <>
              <Grid columns={{ base: 1, md: 3 }}>
                <Stat label={`Told in ${WINDOW_LABELS[window]}`} value={series.total} hint={series.comparedTotal !== null ? <>{series.comparedTotal.toLocaleString('en')} {compare === 'week' ? 'a week before' : 'the window before'}{change !== null && ` (${change > 0 ? '+' : ''}${change}%)`}</> : undefined} />
              </Grid>
              <ChartPanel title={<>Every {BUCKET_LABELS[bucket]}, {when(series.from)} to {when(series.to)}</>}>
                <TimeSeries
                  label={`${event}, every ${BUCKET_LABELS[bucket]}, over ${WINDOW_LABELS[window]}`}
                  points={series.points}
                  marks={marksOn(series.points.map(point => point.at), marks)}
                  compared={series.compared}
                  names={{ points: `Last ${WINDOW_LABELS[window]}`, compared: comparedName }}
                  formatTime={format}
                />
              </ChartPanel>
            </>
          )
        : <Skeleton lines={6} />}
      <Grid columns={{ base: 1, md: 2 }}>
        {tops.map(({ by, top }) => (
          <Box key={by} label={by === 'actor' ? 'Who tells it most' : `Its ${by.slice(6)}s`}>
            <BoxHeader>{by === 'actor' ? 'Who tells it most' : <>By {by.slice(6)}</>}</BoxHeader>
            {top.length === 0 && <BoxEmpty icon={UserIcon} title="Nobody in this window" />}
            {top.map(row => (
              <BoxRow key={row.value ?? 'none'} trailing={<Text size="sm" tone="muted">{row.count.toLocaleString('en')}</Text>}>
                {row.value === null
                  ? <Text size="sm" tone="muted">{by === 'actor' ? 'No one (a worker, a schedule)' : 'Outside any'}</Text>
                  : <Button size="sm" variant="link" onClick={() => void service.filter(by === 'actor' ? { actor: row.value } : { scope: `${by.slice(6)}:${row.value}` })}><Mono>{row.value}</Mono></Button>}
              </BoxRow>
            ))}
          </Box>
        ))}
      </Grid>
      <TraceList appId={app.id} title="Traces that told it" query={{ context, told: event }} window={window} />
    </Stack>
  )
}
