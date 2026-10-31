import { LOST_AFTER_MS, SAMPLE_EVERY_MS, type InstanceMinute, type InstanceSample, type InstanceState, type MeanMax, type MeanMin } from '../../core/metrics/instance-sample'
import { MINUTE_MS } from './minutes'

/** An instance's last sample, and when it said it stopped: what its state is made of. */
export type InstanceLast = { sample: InstanceSample, stoppedAt: string | null }

/** The 10-second slot of its minute a time is in: 0 to 5. */
export function slotOf(at: Date): number {
  return Math.floor((at.getTime() % MINUTE_MS) / SAMPLE_EVERY_MS)
}

const meanMax = (values: number[]): MeanMax => ({ mean: values.reduce((sum, value) => sum + value, 0) / values.length, max: Math.max(...values) })
const meanMin = (values: number[]): MeanMin => ({ mean: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values) })

/** One instance's samples of a minute, at least one, summed up. */
export function instanceMinuteOf(minute: string, samples: InstanceSample[]): InstanceMinute {
  const last = samples.at(-1)!
  const usages = samples.map(sample => sample.server.cpu.usage).filter(usage => usage !== null)
  return {
    minute,
    instance: last.instance,
    slots: [...new Set(samples.map(sample => slotOf(sample.at)))].sort(),
    process: {
      rssBytes: meanMax(samples.map(sample => sample.process.rssBytes)),
      heapUsedBytes: meanMax(samples.map(sample => sample.process.heapUsedBytes)),
      cpu: meanMax(samples.map(sample => sample.process.cpu)),
      loopMeanMs: meanMax(samples.map(sample => sample.process.loopMeanMs)).mean,
      loopMaxMs: Math.max(...samples.map(sample => sample.process.loopMaxMs)),
    },
    server: {
      name: last.server.name,
      // The paths of its last sample: one dropped meanwhile is no longer watched.
      disks: last.server.disks.map(disk => ({
        path: disk.path,
        totalBytes: disk.totalBytes,
        freeBytes: meanMin(samples.flatMap(sample => sample.server.disks.filter(each => each.path === disk.path).map(each => each.freeBytes))),
      })),
      memory: { totalBytes: last.server.memory.totalBytes, freeBytes: meanMin(samples.map(sample => sample.server.memory.freeBytes)) },
      cpu: {
        cores: last.server.cpu.cores,
        load: meanMax(samples.map(sample => sample.server.cpu.load[0])),
        usage: usages.length > 0 ? meanMax(usages) : null,
      },
    },
  }
}

/** An instance as it is now, by its last sample: lost once it has not sampled for `LOST_AFTER_MS`. */
export function instanceStateOf({ sample, stoppedAt }: InstanceLast, now: Date): InstanceState {
  const status = stoppedAt !== null ? 'stopped' : now.getTime() - sample.at.getTime() > LOST_AFTER_MS ? 'lost' : 'alive'
  return {
    instance: sample.instance,
    pid: sample.pid,
    startedAt: sample.startedAt,
    lastSeenAt: sample.at.toISOString(),
    status,
    stoppedAt,
    process: sample.process,
    server: sample.server,
  }
}
