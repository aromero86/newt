import { Grid } from 'newt-react-ui/grid'
import { Stat } from 'newt-react-ui/stat'
import { useService, useValue } from 'newt-react'
import { formatBytes, formatMs, formatPercent } from '../app-metrics/metrics-format'
import { AppService } from '../app.service'

/**
 * Its servers and instances at a glance, once any was heard of: how many instances are
 * alive, the disk that fills soonest, the fullest memory and the worst event loop.
 */
export function AppOverviewServers() {
  const instances = useValue(useService(AppService).instances)
  if (!instances || instances.instances.length === 0) return null

  const alive = instances.instances.filter(instance => instance.status === 'alive')
  const disks = instances.servers.flatMap(server => server.disks.map(disk => ({ server: server.name, ...disk })))
  const filling = disks.filter(disk => disk.fullInDays !== null).sort((a, b) => a.fullInDays! - b.fullInDays!)[0]
  const tightest = filling ?? disks.sort((a, b) => a.freeBytes / a.totalBytes - b.freeBytes / b.totalBytes)[0]
  const fullest = instances.servers
    .map(server => ({ name: server.name, used: server.memory.totalBytes === 0 ? 0 : ((server.memory.totalBytes - server.memory.freeBytes) / server.memory.totalBytes) * 100 }))
    .sort((a, b) => b.used - a.used)[0]
  const worst = alive.toSorted((a, b) => b.process.loopMaxMs - a.process.loopMaxMs)[0]
  const many = instances.servers.length > 1

  return (
    <Grid columns={{ base: 2, md: 4 }}>
      <Stat label="Instances alive" value={alive.length} hint={`on ${instances.servers.length} ${many ? 'servers' : 'server'}, ${instances.instances.length} heard of in a week`} />
      <Stat
        label={filling ? 'Disk full in' : 'Disk free'}
        value={tightest ? (filling ? `${Math.floor(filling.fullInDays!)} days` : formatBytes(tightest.freeBytes)) : '–'}
        hint={tightest ? `${tightest.path}${many ? ` of ${tightest.server}` : ''}, ${formatBytes(tightest.freeBytes)} free of ${formatBytes(tightest.totalBytes)}` : undefined}
      />
      <Stat label="Memory in use" value={formatPercent(fullest?.used ?? null)} hint={fullest && many ? `of ${fullest.name}, the fullest` : undefined} />
      <Stat label="Worst event loop" value={worst ? formatMs(worst.process.loopMaxMs) : '–'} hint={worst ? `its longest delay, ${formatMs(worst.process.loopMeanMs)} on average` : 'no instance alive'} />
    </Grid>
  )
}
