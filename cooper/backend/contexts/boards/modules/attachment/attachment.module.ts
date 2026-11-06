import { eventsOf, Module, now, UseCase } from '@newt-kit/newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
import {
  Attachment,
  ATTACHMENT_RULE,
  AttachmentStartSchema,
  MAX_ATTACHMENTS,
  type AttachmentDTO,
  type AttachmentUploadDTO,
} from './attachment'
import type { Attachment_Deps } from './attachment.deps'
import { Attachment_Repository } from './attachment.repository'
import { registerAttachmentRoutes } from './attachment.routes'
import { registerAttachmentWorkers } from './attachment.workers'
import { AttachmentNotFound } from './errors/attachment-not-found'
import { AttachmentRefused } from './errors/attachment-refused'
import { TooManyAttachments } from './errors/too-many-attachments'
import { Attachment_Refused } from './events/attachment-refused'
import { Attachment_Removed } from './events/attachment-removed'

/** How long an address to upload to works. */
const UPLOAD_SECONDS = 5 * 60
/** How long an address to read from works: only for the redirect it is given in. */
const DOWNLOAD_SECONDS = 60
const HOUR_MS = 60 * 60 * 1000
/** How many unfinished uploads one sweep takes: the next hour takes the rest. */
const SWEEP = 500

/**
 * The files of each card, private to its workspace: a row says what each is, and the
 * context's private storage keeps its bytes. The client uploads straight to the storage;
 * nothing it says of a file counts until `uploadConfirm` looks at what came. Bytes are
 * written first and deleted last, by a worker, so no row points at nothing.
 */
export class Attachment_Module extends Module {

  static initialize(base: BoardsBase, deps: Attachment_Deps): Attachment_Module {
    const module = new Attachment_Module(base, new Attachment_Repository(base), deps)
    registerAttachmentRoutes(base, module, deps)
    registerAttachmentWorkers(module, deps)
    return module
  }

  readonly events
  /** Told once an hour: what stayed pending is swept. */
  readonly hourly
  private readonly files

  private constructor(base: BoardsBase, private readonly repo: Attachment_Repository, private readonly deps: Attachment_Deps) {
    super('attachment', base.invocations, deps)
    this.files = base.storage.private.in('attachment')
    this.events = eventsOf(base.bus, { removed: Attachment_Removed, refused: Attachment_Refused })
    this.hourly = base.schedules.define('attachment.hourly', '0 * * * *')
  }

  /** A file about to be uploaded to a card: where the client sends it. */
  @UseCase()
  async uploadStart(cardId: string, input: unknown): Promise<AttachmentUploadDTO> {
    const parsed = AttachmentStartSchema.parse(input)
    await this.deps.card.get(cardId)
    // For a clear answer in the usual case: the save checks it again, where nothing slips in between.
    if (await this.repo.count({ cardId }) >= MAX_ATTACHMENTS) throw new TooManyAttachments()
    const attachment = Attachment.start({ workspaceId: currentWorkspaceId(), cardId, ...parsed })
    await this.repo.persistWithRoom(attachment)
    const uploadUrl = await this.files.uploadUrl(attachment.id, {
      expiresIn: UPLOAD_SECONDS,
      contentType: parsed.contentType,
      maxBytes: ATTACHMENT_RULE.maxBytes,
    })
    return { attachment: attachment.toDTO(), uploadUrl }
  }

  /**
   * The client says the file was sent: it is ready if what came is what it said, by its
   * length and its first bytes. Otherwise it goes. Asked again once ready, it is ready.
   */
  @UseCase()
  async uploadConfirm(id: string): Promise<AttachmentDTO> {
    const attachment = await this.load(id)
    if (attachment.isReady) return attachment.toDTO()
    const refused = await this.files.verifyUpload(attachment.id, {
      contentType: attachment.contentType,
      maxBytes: ATTACHMENT_RULE.maxBytes,
    })
    if (refused) {
      attachment.refuse()
      await this.repo.persist(attachment)
      throw new AttachmentRefused(refused)
    }
    attachment.markReady((await this.files.stat(attachment.id))!.size)
    await this.repo.persist(attachment)
    return attachment.toDTO()
  }

  /** Where someone of the workspace reads a file, for a moment: it was asked who they are on the way in. */
  @UseCase()
  async downloadUrl(id: string): Promise<string> {
    const attachment = await this.load(id)
    if (!attachment.isReady) throw new AttachmentNotFound(id)
    return this.files.signedUrl(attachment.id, {
      expiresIn: DOWNLOAD_SECONDS,
      contentType: attachment.contentType,
      filename: attachment.filename,
    })
  }

  /** A card's files, the first one first: `MAX_ATTACHMENTS` at most. */
  @UseCase()
  async listForCard(cardId: string): Promise<AttachmentDTO[]> {
    await this.deps.card.get(cardId)
    const found = await this.repo.find({ cardId, status: 'ready' }, { orderBy: [{ field: 'createdAt' }] })
    return found.map(attachment => attachment.toDTO())
  }

  @UseCase()
  async remove(id: string): Promise<void> {
    const attachment = await this.load(id)
    attachment.remove()
    await this.repo.persist(attachment)
  }

  /** From a worker: the bytes of what is gone. A second run finds nothing to delete. */
  @UseCase()
  async removeBytes(id: string): Promise<void> {
    await this.files.delete(id)
  }

  /** From a worker: a card went, and its files with it. */
  @UseCase()
  async removeOfCard(workspaceId: string, cardId: string): Promise<void> {
    await runInWorkspace(workspaceId, () => this.removeAll(() => this.repo.find({ cardId })))
  }

  /** From a worker: auth deleted a workspace, and its files go with it. */
  @UseCase()
  async removeOfWorkspace(workspaceId: string): Promise<void> {
    await runInWorkspace(workspaceId, () => this.removeAll(() => this.repo.find({})))
  }

  /** From a schedule: uploads started over an hour ago and never finished. */
  @UseCase()
  async sweepPending(): Promise<void> {
    const before = new Date(now().getTime() - HOUR_MS).toISOString()
    for (const attachment of await this.repo.pendingInEveryScopeSince(before, SWEEP)) {
      await runInWorkspace(attachment.workspaceId, async () => {
        attachment.remove()
        await this.repo.persist(attachment)
      })
    }
  }

  private async removeAll(find: () => Promise<Attachment[]>): Promise<void> {
    const found = await find()
    found.forEach(attachment => attachment.remove())
    if (found.length > 0) await this.repo.persist(...found)
  }

  private load(id: string): Promise<Attachment> {
    return this.resolve(() => this.repo.find({ id }), () => new AttachmentNotFound(id))
  }
}
