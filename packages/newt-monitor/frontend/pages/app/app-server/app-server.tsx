import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { ChartPanel, ChartRow } from 'newt-react-ui/chart-panel'
import { Grid } from 'newt-react-ui/grid'
import { Inline } from 'newt-react-ui/inline'
import { LineChart } from 'newt-react-ui/line-chart'
import { TextLink } from 'newt-react-ui/link'
import { Select } from 'newt-react-ui/select'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { Subhead } from 'newt-react-ui/subhead'
import { Mono } from 'newt-react-ui/text'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { marksOn, useAppMarks } from '../app-metrics/chart-marks'
import { BUCKET_LABELS, formatBytes, formatPercent, timeFormat, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { diskOf, InstanceList, memoryOf } from '../app-servers/instance-list'
import { AppService } from '../app.service'
import { AppServerService } from './app-server.service'

/** One server the application runs on: its memory, processors and disks now and over a window, and its instances. With its own AppServerService. */
export function AppServer({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppServerService]}>
      <AppServerWrapped app={app} />
    </Provide>
  )
}

function AppServerWrapped({ app }: { app: AppDTO }) {
  const name = useParams().server!
  const service = useService(AppServerService)
  const instances = useValue(useService(AppService).instances)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  const series = useValue(service.series)
  const failure = useValue(service.failure)
  const marks = useAppMarks()

  useEffect(() => {
    void service.open(name)
  }, [service, name])

  const server = instances?.servers.find(each => each.name === name)
  const its = instances?.instances.filter(instance => instance.server === name) ?? []
  const format = timeFormat(window, bucket)
  const times = series?.points.map(point => point.at) ?? []
  const paths = Object.keys(series?.disks ?? {})

  return (
    <Stack gap={4}>
      <Subhead
        title={<Mono>{name}</Mono>}
        description={(instances?.servers.length ?? 0) > 1
          ? <>One of the <TextLink href={`/apps/${app.id}/servers`}>servers</TextLink> {app.name} runs on, as its instances read it.</>
          : <>The server {app.name} runs on, as its instances read it.</>}
      />
      {server && (
        <Grid columns={{ base: 2, md: 4 }}>
          <Stat label="Memory in use" value={formatBytes(server.memory.totalBytes - server.memory.freeBytes)} hint={memoryOf(server.memory)} />
          <Stat label="Processors busy" value={formatPercent(server.cpu.usage)} hint={`load ${server.cpu.load.map(load => load.toFixed(2)).join(' · ')} on ${server.cpu.cores} cores`} />
          <Stat label="Disk free" value={server.disks.length ? formatBytes(Math.min(...server.disks.map(disk => disk.freeBytes))) : '–'} hint={server.disks.map(diskOf).join('; ')} />
          <Stat label="Instances alive" value={server.instances.alive} hint={`of ${server.instances.total} heard of in a week`} />
        </Grid>
      )}
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => void service.showWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
        <Select size="compact" label="Bucket" value={bucket} onValueChange={value => void service.showBucket(value as MetricsBucket)} options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))} />
      </Inline>
      {failure && <Alert tone="bad" title="Could not load the server">{failure}</Alert>}
      {series
        ? (
            <ChartRow>
              <ChartPanel title={<>Memory (at its fullest), every {BUCKET_LABELS[bucket]}</>}>
                <LineChart
                  label={`${name}: memory in use and its total`}
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
              <ChartPanel title={<>Processors, every {BUCKET_LABELS[bucket]}</>}>
                <LineChart
                  label={`${name}: processors busy on average and at the most, and load`}
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
              <ChartPanel title={<>Disks free (at the lowest), every {BUCKET_LABELS[bucket]}</>}>
                <LineChart
                  label={`${name}: each disk's free space`}
                  times={times}
                  marks={marksOn(times, marks)}
                  formatTime={format}
                  formatValue={value => formatBytes(value)}
                  series={paths.map((path, index) => ({ key: `disk${index}`, label: path, tone: (['brand', 'ok', 'warn', 'muted'] as const)[index % 4]!, values: series.points.map(point => point.disks[path] ?? null) }))}
                />
              </ChartPanel>
            </ChartRow>
          )
        : <Skeleton lines={6} />}
      <InstanceList appId={app.id} instances={its} showServer={false} />
    </Stack>
  )
}
