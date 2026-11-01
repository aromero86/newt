import { ConflictError } from '@newt-kit/newt/core'

/** Only a dead job is retried: one waiting or running is on its way, one done is done. */
export class JobNotDead extends ConflictError {
  readonly code = 'outbox.job_not_dead'
  constructor(id: string, status: string) {
    super(`Job ${id} is ${status}, not dead: only a dead job is retried`)
  }
}
