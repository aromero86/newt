import { Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { Job } from 'newt/port-outbox'
import type { CooperBase } from '../cooper-base'
import { JobNotDead } from './errors/job-not-dead'
import { JobNotFound } from './errors/job-not-found'
import type { DeadJobDTO } from './outbox.schema'

/** The event's name, from the job's copy of it. */
function eventName(job: Job): string {
  try {
    return String((JSON.parse(job.event) as { name?: unknown }).name ?? '')
  } catch {
    return ''
  }
}

function toDTO(job: Job): DeadJobDTO {
  const { id, queue, attempts, lastError, createdAt, updatedAt } = job
  return { id, queue, event: eventName(job), attempts, lastError, createdAt, updatedAt }
}

/**
 * A context's own jobs, for whoever looks after them: those that ran out of
 * attempts, and putting one back to run once what killed it is fixed. Each context
 * initializes one over its own store's outbox, and the staff's backoffice reaches
 * them through these use cases, never through another context's base or store.
 *
 * It has no routes: the backoffice's are the only ones, and they check who asks.
 */
export class Outbox_Module extends Module {

  static initialize(base: CooperBase): Outbox_Module {
    return new Outbox_Module(base)
  }

  private constructor(private readonly base: CooperBase) {
    super('outbox', base.invocations)
  }

  /**
   * A page of its dead jobs, the newest first (by id: one made later has a greater
   * one): they wait for someone, and are few, so they are all read, and the page is
   * cut here, its cursor still good once the job it names was retried.
   */
  @UseCase()
  async dead(page: PageRequest): Promise<Page<DeadJobDTO>> {
    const dead = (await this.base.store.outbox.list({ status: 'dead' })).toSorted((a, b) => (a.id < b.id ? 1 : -1))
    const after = page.cursor ? dead.filter(job => job.id < page.cursor!) : dead
    return { items: after.slice(0, page.size).map(toDTO), hasMore: after.length > page.size, total: dead.length }
  }

  /**
   * Puts a dead job back to wait, as new: its worker runs it again at once, with all its
   * attempts. A plain use case: it writes no module's rows through a repository, which
   * is what the write rule watches, but the store's outbox, in one step.
   */
  @UseCase()
  async retry(id: string): Promise<void> {
    if (await this.base.store.outbox.retry(id)) return
    const job = await this.base.store.outbox.get(id)
    throw job ? new JobNotDead(id, job.status) : new JobNotFound(id)
  }
}
