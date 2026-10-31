import { useEffect } from 'react'
import { GaugeIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { ChartPanel, ChartRow } from 'newt-react-ui/chart-panel'
import { Grid } from 'newt-react-ui/grid'
import { Inline } from 'newt-react-ui/inline'
import { LineChart } from 'newt-react-ui/line-chart'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Select } from 'newt-react-ui/select'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { Subhead } from 'newt-react-ui/subhead'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { marksOn, useAppMarks } from '../app-metrics/chart-marks'
import { BUCKET_LABELS, formatBytes, formatMs, formatPercent, timeFormat, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'
import { AppSystemService } from './app-system.service'
import { diskOf, InstanceList, memoryOf } from './instance-list'

/**
 * The System tab: the application as a whole, whatever instances and machines it runs
 * on, now and over a window. Its lines go on across deployments, where each instance,
 * and each container, is a new one.
 */
export function AppSystem({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppSystemService]}>
      <AppSystemWrapped app={app} />
    </Provide>
  )
}

function AppSystemWrapped({ app }: { app: AppDTO }) {
  const service = useService(AppSystemService)
  const appService = useService(AppService)
  const instances = useValue(appService.instances)
  const instancesFailure = useValue(appService.instancesFailure)
  const loaded = useValue(service.loaded)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  const count = useValue(service.count)
  const series = useValue(service.series)
  const failure = useValue(service.failure)
  const marks = useAppMarks()

  useEffect(() => {
    void service.open()
  }, [service])

  if (!loaded) return <Skeleton lines={6} />
  if (instances && instances.instances.length === 0 && !series?.points.some(point => point.rssBytes !== null)) {
    return (
      <Box label="System">
        <BoxEmpty icon={GaugeIcon} title="No instance heard of yet" description="Each instance of the application reads itself and its machine every 10 seconds; the monitor collects them every minute." />
      </Box>
    )
  }

  const system = instances?.system
  const tightest = system?.disks.filter(disk => disk.fullInDays !== null).sort((a, b) => a.fullInDays! - b.fullInDays!)[0]
    ?? system?.disks.toSorted((a, b) => a.freeBytes - b.freeBytes)[0]
  const format = timeFormat(window, bucket)
  const times = series?.points.map(point => point.at) ?? []
  const paths = Object.keys(series?.disks ?? {})
  const every = BUCKET_LABELS[bucket]

  return (
    <Stack gap={4}>
      {instancesFailure && <Alert tone="bad" title="Could not load its instances">{instancesFailure}</Alert>}
      {instances && (
        <Grid columns={{ base: 2, md: 4 }}>
          <Stat label="Instances alive" value={system?.instances ?? 0} hint={system ? <>read <RelativeTime date={system.at} /></> : 'none now'} />
          <Stat label="Its memory" value={system ? formatBytes(system.process.rssBytes) : '–'} hint={system ? `heap ${formatBytes(system.process.heapUsedBytes)}, its instances added up` : undefined} />
          <Stat label="Its processor" value={system ? formatPercent(system.process.cpu) : '–'} hint="of one core, its instances added up" />
          <Stat label="Worst event loop" value={system ? formatMs(system.process.loopMaxMs) : '–'} hint="its longest delay, of the instances alive" />
          <Stat label="Machine memory in use" value={system ? formatBytes(system.memory.totalBytes - system.memory.freeBytes) : '–'} hint={system ? memoryOf(system.memory) : undefined} />
          <Stat label="Processors busy" value={formatPercent(system?.cpu.usage ?? null)} hint={system ? `load ${system.cpu.load.toFixed(2)} on ${system.cpu.cores} cores` : undefined} />
          <Stat
            label={tightest?.fullInDays != null ? 'Disk full in' : 'Disk free'}
            value={tightest ? (tightest.fullInDays !== null ? `${Math.floor(tightest.fullInDays)} days` : formatBytes(tightest.freeBytes)) : '–'}
            hint={system?.disks.map(diskOf).join('; ')}
          />
        </Grid>
      )}
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => void service.showWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
        <Select size="compact" label="Bucket" value={bucket} onValueChange={value => void service.showBucket(value as MetricsBucket)} options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))} />
      </Inline>
      {failure && <Alert tone="bad" title="Could not load the system">{failure}</Alert>}
      {count && series
        ? (
            <>
              <Subhead title="The application" description={`${app.name}'s instances added up, whichever were alive.`} />
              <ChartRow>
                <ChartPanel title={<>Instances alive, every {every}</>}>
                  <LineChart
                    label={`${app.name}: instances alive, the fewest and the most`}
                    times={count.points.map(point => point.at)}
                    marks={marksOn(count.points.map(point => point.at), marks)}
                    formatTime={format}
                    series={[
                      { key: 'max', label: 'The most', tone: 'brand', values: count.points.map(point => point.max) },
                      { key: 'min', label: 'The fewest', tone: 'warn', values: count.points.map(point => point.min) },
                    ]}
                  />
                </ChartPanel>
                <ChartPanel title={<>Memory, every {every}</>}>
                  <LineChart
                    label={`${app.name}: its instances' memory added up, on average and at the most`}
                    times={times}
                    marks={marksOn(times, marks)}
                    formatTime={format}
                    formatValue={value => formatBytes(value)}
                    series={[
                      { key: 'rss', label: 'On average', tone: 'brand', values: series.points.map(point => point.rssBytes) },
                      { key: 'rssMax', label: 'At the most', tone: 'warn', values: series.points.map(point => point.rssMaxBytes) },
                    ]}
                  />
                </ChartPanel>
                <ChartPanel title={<>Processor, every {every}</>}>
                  <LineChart
                    label={`${app.name}: its instances' processor added up, as a share of one core, on average and at the most`}
                    times={times}
                    marks={marksOn(times, marks)}
                    formatTime={format}
                    formatValue={value => formatPercent(value)}
                    series={[
                      { key: 'cpu', label: 'On average', tone: 'brand', values: series.points.map(point => point.cpu) },
                      { key: 'cpuMax', label: 'At the most', tone: 'warn', values: series.points.map(point => point.cpuMax) },
                    ]}
                  />
                </ChartPanel>
                <ChartPanel title={<>Event loop at its worst, every {every}</>}>
                  <LineChart
                    label={`${app.name}: the longest event loop delay of any instance`}
                    times={times}
                    marks={marksOn(times, marks)}
                    formatTime={format}
                    formatValue={value => formatMs(value)}
                    series={[{ key: 'loop', label: 'Worst delay', tone: 'bad', values: series.points.map(point => point.loopMaxMs) }]}
                  />
                </ChartPanel>
              </ChartRow>
              <Subhead title="The machines" description="Where it runs, at the fullest: the least free memory, the busiest processors and each disk at its lowest." />
              <ChartRow>
                <ChartPanel title={<>Memory (at its fullest), every {every}</>}>
                  <LineChart
                    label={`${app.name}: its machines' memory in use and its total`}
                    times={times}
                    marks={marksOn(times, marks)}
                    formatTime={format}
                    formatValue={value => formatBytes(value)}
                    series={[
                      { key: 'used', label: 'In use', tone: 'brand', values: series.points.map(point => (point.memoryTotalBytes === null || point.memoryFreeBytes === null ? null : point.memoryTotalBytes - point.memoryFreeBytes)) },
                      { key: 'total', label: 'Total', tone: 'muted', dashed: true, values: series.points.map(point => point.memoryTotalBytes) },
                    ]}
                  />
                </ChartPanel>
                <ChartPanel title={<>Processors, every {every}</>}>
                  <LineChart
                    label={`${app.name}: its machines' processors busy on average and at the most, and load`}
                    times={times}
                    marks={marksOn(times, marks)}
                    formatTime={format}
                    formatValue={value => formatPercent(value)}
                    formatRight={value => value.toFixed(2)}
                    series={[
                      { key: 'usage', label: 'Busy', tone: 'brand', values: series.points.map(point => point.cpuUsage) },
                      { key: 'usageMax', label: 'Busy at the most', tone: 'warn', values: series.points.map(point => point.cpuUsageMax) },
                      { key: 'load', label: 'Load', tone: 'muted', axis: 'right', values: series.points.map(point => point.load) },
                    ]}
                  />
                </ChartPanel>
                <ChartPanel title={<>Disks free (at the lowest), every {every}</>}>
                  <LineChart
                    label={`${app.name}: each disk's free space`}
                    times={times}
                    marks={marksOn(times, marks)}
                    formatTime={format}
                    formatValue={value => formatBytes(value)}
                    series={paths.map((path, index) => ({ key: `disk${index}`, label: path, tone: (['brand', 'ok', 'warn', 'muted'] as const)[index % 4]!, values: series.points.map(point => point.disks[path] ?? null) }))}
                  />
                </ChartPanel>
              </ChartRow>
            </>
          )
        : <Skeleton lines={6} />}
      {instances && <InstanceList instances={instances.instances} repository={app.repository} />}
    </Stack>
  )
}
