import { currentActor, eventsOf, Module, now, UseCase } from '@newt-kit/newt/core'
import type { AuthBase } from '../../auth-base'
import { Avatar, AVATAR_RULE, AvatarStartSchema, type AvatarConfirmedDTO, type AvatarUploadDTO } from './avatar'
import { Avatar_Repository } from './avatar.repository'
import { registerAvatarRoutes } from './avatar.routes'
import { registerAvatarWorkers } from './avatar.workers'
import { AvatarNotFound } from './errors/avatar-not-found'
import { AvatarRefused } from './errors/avatar-refused'
import { Avatar_Ready } from './events/avatar-ready'
import { Avatar_Removed } from './events/avatar-removed'

/** How long an address to upload to works. */
const UPLOAD_SECONDS = 5 * 60
const HOUR_MS = 60 * 60 * 1000

/**
 * People's pictures, public: anyone showing someone reads theirs at one address, for good.
 * A new picture has a new key, so a cache never shows an old one under it. The client
 * uploads straight to the storage; nothing it says counts until `uploadConfirm` looks at
 * what came. `user` hears of a new one, and keeps where it is read from.
 */
export class Avatar_Module extends Module {

  static initialize(base: AuthBase): Avatar_Module {
    const module = new Avatar_Module(base, new Avatar_Repository(base))
    registerAvatarRoutes(base, module)
    registerAvatarWorkers(module)
    return module
  }

  readonly events
  /** Told once an hour: what stayed pending is swept. */
  readonly hourly
  private readonly files

  private constructor(base: AuthBase, private readonly repo: Avatar_Repository) {
    super('avatar', base.invocations)
    this.files = base.storage.public.in('avatar')
    this.events = eventsOf(base.bus, { ready: Avatar_Ready, removed: Avatar_Removed })
    this.hourly = base.schedules.define('avatar.hourly', '0 * * * *')
  }

  /** A picture of whoever is signed in, about to be uploaded: where the client sends it. */
  @UseCase()
  async uploadStart(input: unknown): Promise<AvatarUploadDTO> {
    const { contentType } = AvatarStartSchema.parse(input)
    const avatar = Avatar.start({ userId: currentActor().userId, contentType })
    await this.repo.persist(avatar)
    const uploadUrl = await this.files.uploadUrl(avatar.id, { expiresIn: UPLOAD_SECONDS, contentType, maxBytes: AVATAR_RULE.maxBytes })
    return { avatar: avatar.toDTO(), uploadUrl }
  }

  /** The client says the file was sent: it is their picture if what came is what it said. Otherwise it goes. */
  @UseCase()
  async uploadConfirm(id: string): Promise<AvatarConfirmedDTO> {
    const avatar = await this.resolve(() => this.repo.find({ id, userId: currentActor().userId }), () => new AvatarNotFound(id))
    if (!avatar.isReady) {
      const refused = await this.files.verifyUpload(avatar.id, { contentType: avatar.contentType, maxBytes: AVATAR_RULE.maxBytes })
      if (refused) {
        avatar.remove()
        await this.repo.persist(avatar)
        throw new AvatarRefused(refused)
      }
      avatar.markReady()
      await this.repo.persist(avatar)
    }
    return { avatar: avatar.toDTO(), url: this.files.url(avatar.id) }
  }

  /** Where someone's picture is read from now, if they have one: what a worker running late reads again. */
  @UseCase()
  async currentUrl(userId: string): Promise<string | null> {
    const latest = await this.repo.latestReady(userId)
    return latest ? this.files.url(latest.id) : null
  }

  /** From a worker: someone's older pictures, once a new one is theirs. A later one is never touched. */
  @UseCase()
  async removeOlder(userId: string, id: string): Promise<void> {
    const older = await this.repo.find({ userId, status: 'ready', id: { lt: id } })
    older.forEach(avatar => avatar.remove())
    if (older.length > 0) await this.repo.persist(...older)
  }

  /** From a worker: the bytes of what is gone. A second run finds nothing to delete. */
  @UseCase()
  async removeBytes(id: string): Promise<void> {
    await this.files.delete(id)
  }

  /** From a schedule: uploads started over an hour ago and never finished. */
  @UseCase()
  async sweepPending(): Promise<void> {
    const before = new Date(now().getTime() - HOUR_MS).toISOString()
    const stale = await this.repo.find({ status: 'pending', createdAt: { lt: before } }, { limit: 500 })
    stale.forEach(avatar => avatar.remove())
    if (stale.length > 0) await this.repo.persist(...stale)
  }
}
