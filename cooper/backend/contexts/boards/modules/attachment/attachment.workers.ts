import type { Attachment_Deps } from './attachment.deps'
import type { Attachment_Module } from './attachment.module'

/** What the files do when something happens: each a job saved with it, safe to run again. */
export function registerAttachmentWorkers(attachments: Attachment_Module, deps: Attachment_Deps): void {
  attachments.events.removed.subscribe(({ id }) => attachments.removeBytes(id), {
    strategy: 'handler',
    queue: 'attachment.removeBytes.on.attachment.removed',
  })
  attachments.events.refused.subscribe(({ id }) => attachments.removeBytes(id), {
    strategy: 'handler',
    queue: 'attachment.removeBytes.on.attachment.refused',
  })
  deps.card.events.deleted.subscribe(({ workspaceId, id }) => attachments.removeOfCard(workspaceId, id), {
    strategy: 'handler',
    queue: 'attachment.removeOfCard.on.card.deleted',
  })
  deps.auth.tenant.events.deleted.subscribe(({ id }) => attachments.removeOfWorkspace(id), {
    strategy: 'handler',
    queue: 'attachment.removeOfWorkspace.on.tenant.deleted',
  })
  attachments.hourly.subscribe(() => attachments.sweepPending(), {
    strategy: 'handler',
    queue: 'attachment.sweepPending.on.attachment.hourly',
  })
}
