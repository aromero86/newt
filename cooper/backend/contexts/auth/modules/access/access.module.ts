import { currentActor, DuplicateValue, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt-kit/core'
import type { AuthBase } from '../../auth-base'
import { Access, AccessAdmitSchema, AccessGrantSchema, type AccessAdmitDTO, type AccessDTO, type AccessGrantDTO } from './access'
import type { Access_Deps } from './access.deps'
import { Access_Repository } from './access.repository'
import { AccessNotFound } from './errors/access-not-found'
import { AdminNotRevocable } from './errors/admin-not-revocable'
import { NotAMember } from './errors/not-a-member'
import { NotAdmin } from './errors/not-admin'
import { Access_Granted } from './events/access-granted'
import { Access_Revoked } from './events/access-revoked'

/** A page of accesses as a page of their DTOs. */
const toDTOs = (found: Page<Access>): Page<AccessDTO> => mapPage(found, access => access.toDTO())

/**
 * Who may enter each product: the members of each workspace of `cooper`, and the
 * staff of `backoffice`. It is asked every time (`check`), so an access taken away
 * counts at once.
 */
export class Access_Module extends Module {

  static initialize(base: AuthBase, deps: Access_Deps): Access_Module {
    return new Access_Module(base, new Access_Repository(base), deps)
  }

  readonly events

  private constructor(base: AuthBase, private readonly repo: Access_Repository, private readonly deps: Access_Deps) {
    super('access', base.invocations, deps)
    this.events = eventsOf(base.bus, { granted: Access_Granted, revoked: Access_Revoked })
  }

  /**
   * Someone's access to a product, for a tenant or (null) for all of it; null when they
   * have none. What every context asks before letting someone in.
   */
  @UseCase()
  async check(userId: string, productId: string, tenantId: string | null = null): Promise<AccessDTO | null> {
    return (await this.repo.first({ userId, productId, tenantId }))?.toDTO() ?? null
  }

  /** The members of a tenant, the oldest first: its admin leads. */
  @UseCase()
  async listForTenant(tenantId: string, page: PageRequest): Promise<Page<AccessDTO>> {
    return toDTOs(await this.repo.page({ tenantId }, page))
  }

  /** Who may enter the whole of a product (no tenant), the oldest first: the staff of `backoffice`. */
  @UseCase()
  async listForProduct(productId: string, page: PageRequest): Promise<Page<AccessDTO>> {
    return toDTOs(await this.repo.page({ productId, tenantId: null }, page))
  }

  /** Someone's accesses, the newest first; to one product only when it is given. */
  @UseCase()
  async listForUser(userId: string, page: PageRequest, productId?: string): Promise<Page<AccessDTO>> {
    return toDTOs(await this.repo.page({ userId, productId }, page, { newestFirst: true }))
  }

  /**
   * The signed-in person gives someone access: a tenant's admin to the tenant, someone
   * of the staff to the whole product. Given twice, it is given once.
   */
  @UseCase()
  async grant(input: AccessGrantDTO): Promise<AccessDTO> {
    const { userId, productId, tenantId } = AccessGrantSchema.parse(input)
    await this.resolveRefs({ productId }, { productId: this.deps.product })
    await this.assertManages(productId, tenantId)
    return this.give({ userId, productId, tenantId, role: 'member' })
  }

  /**
   * The signed-in person takes someone's access away: a tenant's admin, or a member
   * leaving it; someone of the staff, for the whole product. The admin is never
   * removed: a tenant keeps it while it exists; nor the staff's last one, nor by
   * someone of the staff revoked meanwhile (the save checks it).
   */
  @UseCase()
  async revoke(input: AccessGrantDTO): Promise<void> {
    const { userId, productId, tenantId } = AccessGrantSchema.parse(input)
    const actorId = currentActor().userId
    const leaving = tenantId !== null && userId === actorId
    if (!leaving) await this.assertManages(productId, tenantId)
    const access = await this.resolve(() => this.repo.find({ userId, productId, tenantId }), () => new AccessNotFound())
    if (access.role === 'admin') throw new AdminNotRevocable()
    access.revoke()
    if (tenantId === null) await this.repo.persistKeepingOneStaff(access, actorId)
    else await this.repo.persist(access)
  }

  /**
   * An access auth gives on its own, once it checked who may have it: a new tenant's
   * admin (its creator), the member an accepted invitation makes, the first staff a
   * script makes. Safe to run again, even at the same time: given twice, it is given
   * once, and the second time answers with it. A tenant never gets a second admin,
   * whoever asks (the save checks it).
   */
  @UseCase()
  async admit(input: AccessAdmitDTO): Promise<AccessDTO> {
    const { userId, productId, tenantId, role } = AccessAdmitSchema.parse(input)
    await this.resolveRefs({ productId }, { productId: this.deps.product })
    return this.give({ userId, productId, tenantId, role })
  }

  /**
   * A tenant is gone: nobody enters it any more, its admin neither. What its deletion
   * calls, and its worker after it; safe to run again.
   */
  @UseCase()
  async revokeTenant(tenantId: string): Promise<void> {
    const accesses = await this.repo.find({ tenantId })
    for (const access of accesses) access.revoke()
    await this.repo.persist(...accesses)
  }

  private async give(input: { userId: string, productId: string, tenantId: string | null, role: 'admin' | 'member' }): Promise<AccessDTO> {
    const { userId, productId, tenantId } = input
    const existing = await this.repo.first({ userId, productId, tenantId })
    if (existing) return existing.toDTO()
    const access = Access.grant(input)
    try {
      await this.repo.persistKeepingOneAdmin(access)
    } catch (error) {
      // Given by another save at the same time (a tenant's admin, by the request that
      // made it and by its worker): given once, and this one gives what is there. Run
      // again, it would find it; but `tenant.create`, which calls it, never runs again.
      const given = error instanceof DuplicateValue ? await this.repo.first({ userId, productId, tenantId }) : undefined
      if (!given) throw error
      return given.toDTO()
    }
    return access.toDTO()
  }

  /**
   * Whether the signed-in person manages who enters: a tenant's admin, its own; the
   * staff, the whole product. Someone outside a tenant is told it does not exist.
   */
  private async assertManages(productId: string, tenantId: string | null): Promise<void> {
    const mine = await this.repo.first({ userId: currentActor().userId, productId, tenantId })
    if (tenantId !== null && !mine) throw new NotAMember(tenantId)
    if (!mine || (tenantId !== null && mine.role !== 'admin')) throw new NotAdmin()
  }
}
