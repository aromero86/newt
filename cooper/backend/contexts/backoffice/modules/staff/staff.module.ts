import { currentActor, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import { NotStaff } from './errors/not-staff'
import { OwnAccessNotRevocable } from './errors/own-access-not-revocable'
import { StaffAccountNotFound } from './errors/staff-account-not-found'
import type { Staff_Deps } from './staff.deps'
import type { Staff_Options } from './staff-options'
import { registerStaffRoutes } from './staff.routes'
import { StaffGrantSchema, type StaffMemberDTO } from './staff.schema'

/**
 * Who the staff are: whoever has access to the backoffice for no tenant, as auth keeps
 * it. It keeps nothing: it asks auth every time, so an access taken away
 * counts at once, and gives or takes it away through auth's own use cases.
 */
export class Staff_Module extends Module {

  static initialize(base: CooperBase, deps: Staff_Deps, options: Staff_Options): Staff_Module {
    const module = new Staff_Module(base, deps, options)
    registerStaffRoutes(base, module)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: Staff_Deps, private readonly options: Staff_Options) {
    super('staff', base.invocations, deps)
  }

  /**
   * The signed-in person is of the staff, or nothing of the backoffice answers them:
   * what every route of its API checks first (`staffRoutes`).
   */
  @UseCase()
  async enter(): Promise<void> {
    if (!await this.isStaff(currentActor().userId)) throw new NotStaff()
  }

  /** The signed-in person, if they are of the staff: what the backoffice's session says it is. */
  @UseCase()
  async me(): Promise<UserDTO> {
    await this.enter()
    return this.deps.auth.user.get(currentActor().userId)
  }

  @UseCase()
  async isStaff(userId: string): Promise<boolean> {
    return (await this.deps.auth.access.check(userId, this.options.productId, null)) !== null
  }

  /** The staff, the oldest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<StaffMemberDTO>> {
    const accesses = await this.deps.auth.access.listForProduct(this.options.productId, page)
    const users = new Map((await this.deps.auth.user.getMany(accesses.items.map(access => access.userId))).map(user => [user.id, user]))
    return mapPage(accesses, access => {
      const user = users.get(access.userId)
      return user && { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
    })
  }

  /**
   * Someone with an account becomes staff: auth gives them the access, as the
   * signed-in person (auth checks they are staff too). Given twice, it is given once.
   */
  @UseCase()
  async grant(input: unknown): Promise<StaffMemberDTO> {
    const { email } = StaffGrantSchema.parse(input)
    const user = await this.deps.auth.user.findByEmail(email)
    if (!user) throw new StaffAccountNotFound(email)
    const access = await this.deps.auth.access.grant({ userId: user.id, productId: this.options.productId, tenantId: null })
    return { id: access.id, userId: user.id, name: user.name, email: user.email, since: access.createdAt }
  }

  /** Someone leaves the staff: from then on, the backoffice refuses them. Never oneself. */
  @UseCase()
  async revoke(userId: string): Promise<void> {
    if (userId === currentActor().userId) throw new OwnAccessNotRevocable()
    await this.deps.auth.access.revoke({ userId, productId: this.options.productId, tenantId: null })
  }
}
