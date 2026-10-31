/** How often each instance reads itself and its server: six times a minute. */
export const SAMPLE_EVERY_MS = 10_000

/** How long an instance goes without a sample before it is taken for lost: three samples. */
export const LOST_AFTER_MS = 3 * SAMPLE_EVERY_MS

/**
 * The machine an instance runs on, as it read it: its disks, its memory and its
 * processors. Never named: in a container the name is the container's, new at each
 * deployment, and what matters is how the system goes, not which machine.
 */
export type ServerReading = {
  /** Each path it watches, and the file system it is on: `/app/data`. */
  disks: { path: string, totalBytes: number, freeBytes: number }[]
  memory: { totalBytes: number, freeBytes: number }
  cpu: {
    cores: number
    /** The load average of the last 1, 5 and 15 minutes. */
    load: [number, number, number]
    /** How busy its processors were since the last reading, 0 to 100: null where `/proc/stat` is not (outside Linux). */
    usage: number | null
  }
}

/** One process of the application, as it read itself. */
export type ProcessReading = {
  rssBytes: number
  heapUsedBytes: number
  /** Its processor time since the last reading, as a share of one core: over 100 when it used more than one. */
  cpu: number
  /** How late its event loop ran what was due, since the last reading: on average and at worst. */
  loopMeanMs: number
  loopMaxMs: number
}

/** What one instance tells of itself every `SAMPLE_EVERY_MS`. */
export type InstanceSample = {
  /** A new one each time a process starts. */
  instance: string
  pid: number
  startedAt: string
  at: Date
  process: ProcessReading
  server: ServerReading
}

/** A number over a minute's samples: their mean and their highest. */
export type MeanMax = { mean: number, max: number }

/** A number over a minute's samples, where its lowest is what matters: free memory, free disk. */
export type MeanMin = { mean: number, min: number }

/**
 * One instance's minute: the 10-second slots it was sampled in (0 to 5: how many
 * instances there were at each moment comes from them), and its samples summed up.
 */
export type InstanceMinute = {
  /** The minute's start, ISO. */
  minute: string
  instance: string
  /** The 10-second slots of the minute it was sampled in, from 0 to 5. */
  slots: number[]
  process: {
    rssBytes: MeanMax
    heapUsedBytes: MeanMax
    cpu: MeanMax
    loopMeanMs: number
    loopMaxMs: number
  }
  server: {
    disks: { path: string, totalBytes: number, freeBytes: MeanMin }[]
    memory: { totalBytes: number, freeBytes: MeanMin }
    /** `load`: the last minute's load average, as each sample read it. */
    cpu: { cores: number, load: MeanMax, usage: MeanMax | null }
  }
}

/**
 * An instance as it is now: alive while it samples, stopped once it said so on its
 * way out, lost when it stopped sampling without saying it (`LOST_AFTER_MS`).
 */
export type InstanceState = {
  instance: string
  pid: number
  startedAt: string
  lastSeenAt: string
  status: 'alive' | 'stopped' | 'lost'
  stoppedAt: string | null
  /** Its last sample. */
  process: ProcessReading
  server: ServerReading
}

/** Every instance as it is now, the minutes closed since a cursor, and the cursor to ask from next time. */
export type Instances = {
  instances: InstanceState[]
  minutes: InstanceMinute[]
  /** The last minute closed: every instance's minute up to it, included, is in. */
  until: string
}
