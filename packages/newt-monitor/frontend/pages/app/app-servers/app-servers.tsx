import { useEffect } from 'react'
import { Navigate } from 'react-router'
import { ServerIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { ChartPanel, ChartRow } from 'newt-react-ui/chart-panel'
import { Grid } from 'newt-react-ui/grid'
import { Inline } from 'newt-react-ui/inline'
import { LineChart } from 'newt-react-ui/line-chart'
import { Select } from 'newt-react-ui/select'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Stat } from 'newt-react-ui/stat'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsBucket, type MetricsWindow } from '../../../api/event-metrics'
import { marksOn, useAppMarks } from '../app-metrics/chart-marks'
import { BUCKET_LABELS, formatMs, timeFormat, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'
import { AppServersService } from './app-servers.service'
import { InstanceList, ServerList } from './instance-list'

/**
 * The Servers tab: the servers the application runs on and its instances, as they are now,
 * and how many instances were alive over a window. One instance on one server is shown as
 * its server's page.
 */
export function AppServers({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppServersService]}>
      <AppServersWrapped app={app} />
    </Provide>
  )
}

function AppServersWrapped({ app }: { app: AppDTO }) {
  const service = useService(AppServersService)
  const instances = useValue(useService(AppService).instances)
  const loaded = useValue(service.loaded)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  const count = useValue(service.count)
  const failure = useValue(service.failure)
  const marks = useAppMarks()

  useEffect(() => {
    void service.open()
  }, [service])

  if (!loaded) return <Skeleton lines={6} />
  if (!instances || instances.servers.length === 0) {
    return (
      <Box label="Servers">
        <BoxEmpty icon={ServerIcon} title="No instance heard of yet" description="Each instance of the application reads itself and its server every 10 seconds; the monitor collects them every minute." />
      </Box>
    )
  }
  const [only] = instances.servers
  if (instances.servers.length === 1 && instances.instances.length === 1) return <Navigate to={`/apps/${app.id}/servers/${encodeURIComponent(only!.name)}`} replace />

  const alive = instances.instances.filter(instance => instance.status === 'alive')
  const tightest = instances.servers.flatMap(server => server.disks).filter(disk => disk.fullInDays !== null).sort((a, b) => a.fullInDays! - b.fullInDays!)[0]
  const worstLoop = Math.max(0, ...alive.map(instance => instance.process.loopMaxMs))
  const format = timeFormat(window, bucket)

  return (
    <Stack gap={4}>
      <Grid columns={{ base: 2, md: 4 }}>
        <Stat label="Instances alive" value={alive.length} hint={`of ${instances.instances.length} heard of in a week`} />
        <Stat label="Servers" value={instances.servers.length} />
        <Stat label="Soonest full disk" value={tightest ? `${Math.floor(tightest.fullInDays!)} days` : '–'} hint={tightest ? tightest.path : 'no disk is filling'} />
        <Stat label="Worst event loop" value={alive.length ? formatMs(worstLoop) : '–'} hint="its longest delay, of the instances alive" />
      </Grid>
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => void service.showWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
        <Select size="compact" label="Bucket" value={bucket} onValueChange={value => void service.showBucket(value as MetricsBucket)} options={WINDOWS[window].buckets.map(each => ({ value: each, label: `Every ${BUCKET_LABELS[each]}` }))} />
      </Inline>
      {failure && <Alert tone="bad" title="Could not load how many instances were alive">{failure}</Alert>}
      {count
        ? (
            <ChartRow>
              <ChartPanel title={<>Instances alive, every {BUCKET_LABELS[bucket]}</>}>
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
            </ChartRow>
          )
        : <Skeleton lines={4} />}
      <ServerList appId={app.id} servers={instances.servers} />
      <InstanceList appId={app.id} instances={instances.instances} />
    </Stack>
  )
}
