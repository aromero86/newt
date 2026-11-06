import type { AttachmentDTO, AttachmentStartDTO, AttachmentUploadDTO } from '../../../backend/contexts/boards/modules/attachment/attachment.schema'
import { Requester } from '@newt-kit/react'

/** The backend's `attachment` module: the files of each card. */
export class AttachmentApi extends Requester {
  protected readonly path = '/workspaces'

  listForCard(workspaceId: string, cardId: string) {
    return this.get<AttachmentDTO[]>(`/${workspaceId}/cards/${cardId}/attachments`)
  }

  /** A file about to be uploaded: where to send it. */
  uploadStart(workspaceId: string, cardId: string, input: AttachmentStartDTO) {
    return this.post<AttachmentUploadDTO>(`/${workspaceId}/cards/${cardId}/attachments`, input)
  }

  /** The file was sent: whether it is what it said. */
  uploadConfirm(workspaceId: string, attachmentId: string) {
    return this.post<AttachmentDTO>(`/${workspaceId}/attachments/${attachmentId}/confirm`)
  }

  remove(workspaceId: string, attachmentId: string) {
    return this.delete<void>(`/${workspaceId}/attachments/${attachmentId}`)
  }

  /** Where a browser goes to download it: the API checks who it is, and sends it on. */
  downloadAddress(workspaceId: string, attachmentId: string) {
    return `${Requester.baseUrl}${this.path}/${workspaceId}/attachments/${attachmentId}/download`
  }
}
