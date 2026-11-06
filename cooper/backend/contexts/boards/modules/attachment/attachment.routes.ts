import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Attachment_Deps } from './attachment.deps'
import type { Attachment_Module } from './attachment.module'

/** No route takes a file: the client sends it to the address `uploadStart` gives. */
export function registerAttachmentRoutes(base: BoardsBase, attachments: Attachment_Module, deps: Attachment_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/cards/:cardId/attachments', async request => Response.json(await attachments.listForCard(request.params.cardId)))

  workspace.post('/cards/:cardId/attachments', async request => Response.json(await attachments.uploadStart(request.params.cardId, await request.json()), { status: 201 }))

  workspace.post('/attachments/:attachmentId/confirm', async request => Response.json(await attachments.uploadConfirm(request.params.attachmentId)))

  workspace.get('/attachments/:attachmentId/download', async request => Response.redirect(await attachments.downloadUrl(request.params.attachmentId), 302))

  workspace.delete('/attachments/:attachmentId', async request => {
    await attachments.remove(request.params.attachmentId)
    return new Response(null, { status: 204 })
  })
}
