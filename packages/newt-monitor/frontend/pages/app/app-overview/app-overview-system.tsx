import { Grid } from 'newt-react-ui/grid'
import { Stat } from 'newt-react-ui/stat'
import { useService, useValue } from 'newt-react'
import { formatBytes, formatMs, formatPercent } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'

/**
 * Its system at a glance, once any instance was heard of: how many instances are
 * alive, the disk that fills soonest, the machines' memory in use and the worst event loop.
 */
export function AppOverviewSystem() {
  const instances = useValue(useService(AppService).instances)
  if (!instances || instances.instances.length === 0) return null

  const system = instances.system
  const filling = system?.disks.filter(disk => disk.fullInDays !== null).sort((a, b) => a.fullInDays! - b.fullInDays!)[0]
  const tightest = filling ?? system?.disks.toSorted((a, b) => a.freeBytes / a.totalBytes - b.freeBytes / b.totalBytes)[0]
  const memoryUsed = system && system.memory.totalBytes > 0 ? ((system.memory.totalBytes - system.memory.freeBytes) / system.memory.totalBytes) * 100 : null
  const gone = instances.instances.length - (system?.instances ?? 0)

  return (
    <Grid columns={{ base: 2, md: 4 }}>
      <Stat label="Instances alive" value={system?.instances ?? 0} hint={gone > 0 ? `${gone} gone lately` : undefined} />
      <Stat
        label={filling ? 'Disk full in' : 'Disk free'}
        value={tightest ? (filling ? `${Math.floor(filling.fullInDays!)} days` : formatBytes(tightest.freeBytes)) : '–'}
        hint={tightest ? `${tightest.path}, ${formatBytes(tightest.freeBytes)} free of ${formatBytes(tightest.totalBytes)}` : undefined}
      />
      <Stat label="Memory in use" value={formatPercent(memoryUsed)} hint={system ? `its instances, ${formatBytes(system.process.rssBytes)}` : undefined} />
      <Stat label="Worst event loop" value={system ? formatMs(system.process.loopMaxMs) : '–'} hint={system ? 'its longest delay, of the instances alive' : 'no instance alive'} />
    </Grid>
  )
}
