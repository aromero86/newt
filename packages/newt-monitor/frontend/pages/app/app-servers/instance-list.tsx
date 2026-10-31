import { Fragment } from 'react'
import { ServerIcon, SquareStackIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { TextLink } from 'newt-react-ui/link'
import { Mono, Text } from 'newt-react-ui/text'
import type { DiskDTO, InstanceDTO, InstanceStatus, ServerDTO } from '../../../api/instances'
import { formatBytes, formatMs, formatPercent } from '../app-metrics/metrics-format'

const STATUS: Record<InstanceStatus, { tone: 'ok' | 'muted' | 'bad', label: string }> = {
  alive: { tone: 'ok', label: 'Alive' },
  stopped: { tone: 'muted', label: 'Stopped' },
  lost: { tone: 'bad', label: 'Lost' },
}

/** How full a disk is, and in how many days it fills at the pace it has filled lately. */
export function diskOf(disk: DiskDTO): string {
  const used = disk.totalBytes === 0 ? 0 : ((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100
  const fills = disk.fullInDays === null ? '' : `, full in ${disk.fullInDays < 1 ? 'less than a day' : `${Math.floor(disk.fullInDays)} days`}`
  return `${disk.path}: ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)} (${formatPercent(used)} used${fills})`
}

/** How much of a server's memory is in use: `5.2 GB of 8 GB (65%)`. */
export function memoryOf(memory: ServerDTO['memory']): string {
  const used = memory.totalBytes - memory.freeBytes
  return `${formatBytes(used)} of ${formatBytes(memory.totalBytes)} (${formatPercent(memory.totalBytes === 0 ? 0 : (used / memory.totalBytes) * 100)})`
}

/** The application's servers as last read: each one's disks, memory and processors, and how many of its instances are alive. */
export function ServerList({ appId, servers }: { appId: string, servers: ServerDTO[] }) {
  return (
    <Box label="Servers">
      <BoxHeader>Servers <Counter>{servers.length}</Counter></BoxHeader>
      {servers.map(server => (
        <BoxRow key={server.name} leading={<Icon icon={ServerIcon} tone="muted" />} trailing={<Text size="sm" tone="muted">{server.instances.alive} of {server.instances.total} instances alive</Text>}>
          <BoxRowTitle href={`/apps/${appId}/servers/${encodeURIComponent(server.name)}`}><Mono>{server.name}</Mono></BoxRowTitle>
          <BoxRowMeta>
            <>memory {memoryOf(server.memory)}</>
            <>processors {formatPercent(server.cpu.usage)} busy, load {server.cpu.load[0].toFixed(2)} on {server.cpu.cores} cores</>
            {server.disks.map(disk => <Fragment key={disk.path}>{diskOf(disk)}</Fragment>)}
            <>read <RelativeTime date={server.at} /></>
          </BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}

/** Instances as last heard of: alive, stopped or lost, and how each process was doing. */
export function InstanceList({ appId, instances, showServer = true }: { appId: string, instances: InstanceDTO[], showServer?: boolean }) {
  return (
    <Box label="Instances">
      <BoxHeader>Instances <Counter>{instances.length}</Counter></BoxHeader>
      {instances.length === 0 && <BoxEmpty icon={SquareStackIcon} title="None" description="No instance has been heard of in the last week." />}
      {instances.map(instance => (
        <BoxRow key={instance.instanceId} leading={<Badge tone={STATUS[instance.status].tone}>{STATUS[instance.status].label}</Badge>} trailing={<Text size="sm" tone="muted">pid {instance.pid}</Text>}>
          <BoxRowTitle><Mono>{instance.instanceId}</Mono></BoxRowTitle>
          <BoxRowMeta>
            {showServer && <>on <TextLink href={`/apps/${appId}/servers/${encodeURIComponent(instance.server)}`}><Mono>{instance.server}</Mono></TextLink></>}
            <>started <RelativeTime date={instance.startedAt} /></>
            {instance.status === 'alive' ? <>heard <RelativeTime date={instance.lastSeenAt} /></> : <>gone <RelativeTime date={instance.stoppedAt ?? instance.lastSeenAt} /></>}
            <>memory {formatBytes(instance.process.rssBytes)} (heap {formatBytes(instance.process.heapUsedBytes)})</>
            <>processor {formatPercent(instance.process.cpu)}</>
            <>event loop {formatMs(instance.process.loopMeanMs)} mean, {formatMs(instance.process.loopMaxMs)} at worst</>
          </BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}
