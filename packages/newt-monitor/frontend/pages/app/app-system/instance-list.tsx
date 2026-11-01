import { SquareStackIcon } from 'lucide-react'
import { Badge } from '@newt-kit/react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Counter } from '@newt-kit/react-ui/counter'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { TextLink } from '@newt-kit/react-ui/link'
import { Mono, Text } from '@newt-kit/react-ui/text'
import type { DiskDTO, InstanceDTO, InstanceStatus, SystemDTO } from '../../../api/instances'
import { formatBytes, formatMs, formatPercent } from '../app-metrics/metrics-format'
import { commitUrl, shortCommit } from '../app.service'

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

/** How much of the memory is in use: `5.2 GB of 8 GB (65%)`. */
export function memoryOf(memory: SystemDTO['memory']): string {
  const used = memory.totalBytes - memory.freeBytes
  return `${formatBytes(used)} of ${formatBytes(memory.totalBytes)} (${formatPercent(memory.totalBytes === 0 ? 0 : (used / memory.totalBytes) * 100)})`
}

/** Its instances: those alive and those gone lately, the commit each was built from, and how each process was doing. */
export function InstanceList({ instances, repository }: { instances: InstanceDTO[], repository: string | null }) {
  return (
    <Box label="Instances">
      <BoxHeader>Instances <Counter>{instances.length}</Counter></BoxHeader>
      {instances.length === 0 && <BoxEmpty icon={SquareStackIcon} title="None" description="No instance is alive, and none has gone lately." />}
      {instances.map(instance => (
        <BoxRow key={instance.instanceId} leading={<Badge tone={STATUS[instance.status].tone}>{STATUS[instance.status].label}</Badge>} trailing={<Text size="sm" tone="muted">pid {instance.pid}</Text>}>
          <BoxRowTitle><Mono>{instance.instanceId}</Mono></BoxRowTitle>
          <BoxRowMeta>
            {instance.commit && <CommitOf commit={instance.commit} repository={repository} />}
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

/** The commit an instance was built from: linked to it on GitHub when its repository is known. */
function CommitOf({ commit, repository }: { commit: string, repository: string | null }) {
  const url = commitUrl(repository, commit)
  const label = <>commit <Mono>{shortCommit(commit)}</Mono></>
  return url ? <TextLink href={url} external>{label}</TextLink> : label
}
