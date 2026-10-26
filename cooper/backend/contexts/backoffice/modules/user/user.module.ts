import { Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { UserFilterDTO } from '../../../auth/modules/user/user.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { User_Deps } from './user.deps'
import type { User_Options } from './user-options'
import { registerUserRoutes } from './user.routes'
import { UserSearchSchema, type UserDetailDTO, type UserDTO, type UserSearchDTO, type UserWorkspaceDTO } from './user.schema'

/**
 * cooper's accounts, as the staff look them up. auth keeps them; this module only
 * reads, through auth's use cases, and puts together what one screen shows (ch. 26:
 * what a query of one table cannot say, composed from the modules that know).
 */
export class User_Module extends Module {

  static initialize(base: CooperBase, deps: User_Deps, options: User_Options): User_Module {
    const module = new User_Module(base, deps, options)
    registerUserRoutes(base, module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly deps: User_Deps, private readonly options: User_Options) {
    super('user', base.invocations)
  }

  /** Every account, the newest first; with a text, those whose email or name it is. */
  @UseCase()
  async list(input: UserSearchDTO, page: PageRequest): Promise<Page<UserDTO>> {
    const { text } = UserSearchSchema.parse(input)
    const filter: UserFilterDTO | undefined = text
      ? { or: [{ field: 'email', op: 'ieq', value: text }, { field: 'name', op: 'ieq', value: text }] }
      : undefined
    return this.deps.user.list(filter, page)
  }

  @UseCase()
  async get(userId: string): Promise<UserDetailDTO> {
    const user = await this.deps.user.get(userId)
    const [staff, workspaces] = await Promise.all([
      this.deps.staff.isStaff(userId),
      this.deps.access.listForUser(userId, { size: 1 }, this.options.workspacesProduct),
    ])
    return { ...user, staff, workspaces: workspaces.total }
  }

  /** The workspaces someone belongs to, the ones they joined last first, with their role in each. */
  @UseCase()
  async workspaces(userId: string, page: PageRequest): Promise<Page<UserWorkspaceDTO>> {
    await this.deps.user.get(userId)
    const accesses = await this.deps.access.listForUser(userId, page, this.options.workspacesProduct)
    const tenants = new Map((await this.deps.tenant.getMany(accesses.items.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    return {
      // A workspace deleted a moment ago, whose accesses auth's worker has not taken away yet, is left out.
      items: accesses.items.flatMap(access => {
        const tenant = tenants.get(access.tenantId ?? '')
        return tenant ? [{ id: access.id, workspaceId: tenant.id, name: tenant.name, role: access.role, since: access.createdAt }] : []
      }),
      hasMore: accesses.hasMore,
      total: accesses.total,
    }
  }
}
