import type { Outbox_Module } from '../../../../shared/outbox/outbox.module'
import type { Staff_Module } from '../staff/staff.module'
import type { JobContext } from './job.schema'

export interface Job_Deps {
  /** That who asks is of the staff, before any route answers. */
  staff: Staff_Module
  /** Each context's jobs, through the use cases it offers for them: auth's, boards' and the backoffice's own. */
  outboxes: Record<JobContext, Outbox_Module>
}
