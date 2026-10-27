import { currentActor, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { NotTenantAdmin } from './errors/not-tenant-admin'
import { TenantNotFound } from './errors/tenant-not-found'
import { Tenant_Created } from './events/tenant-created'
import { Tenant_Deleted } from './events/tenant-deleted'
import { Tenant_Renamed } from './events/tenant-renamed'
import { Tenant, TenantCreateSchema, TenantFilter, TenantRenameSchema, type TenantDTO } from './tenant'
import type { Tenant_Deps } from './tenant.deps'
import type { Tenant_Options } from './tenant-options'
import { Tenant_Repository, type TenantRow } from './tenant.repository'
import { registerTenantWorkers } from './tenant.workers'

/**
 * The workspaces of `cooper`. auth owns who they are and who belongs to each (through
 * `access`); every other context keeps what it needs of them, by their id, from
 * these events.
 */
export class Tenant_Module extends Module {

  static initialize(base: AuthBase, deps: Tenant_Deps, options: Tenant_Options): Tenant_Module {
    const module = new Tenant_Module(base, new Tenant_Repository(base), deps, options)
    registerTenantWorkers(module)
    return module
  }

  readonly events

  private constructor(
    base: AuthBase,
    private readonly repo: Tenant_Repository,
    private readonly deps: Tenant_Deps,
    private readonly options: Tenant_Options,
  ) {
    super('tenant', base.invocations, deps)
    this.events = eventsOf(base.bus, { created: Tenant_Created, renamed: Tenant_Renamed, deleted: Tenant_Deleted })
  }

  /**
   * A new workspace, made by the signed-in person, who is its admin. It writes to
   * `access` without being a worker, on purpose: whoever makes a workspace enters it
   * the moment it answers. The workspace is saved first and its admin after; should
   * that second save fail, the worker of `tenant.created` (`ensureAdmin`) gives it;
   * whichever of the two gives it second finds it given.
   * It never runs again on a conflict: it would make a second workspace.
   */
  @UseCase({ writesTo: ['access'], retryOnConflict: false })
  async create(input: unknown): Promise<TenantDTO> {
    const { name } = TenantCreateSchema.parse(input)
    const tenant = Tenant.create({ name, createdBy: currentActor().userId })
    await this.repo.persist(tenant)
    await this.admitAdmin(tenant.toDTO())
    return tenant.toDTO()
  }

  /** For contexts that already checked who may see it (a member, the staff). */
  @UseCase()
  async get(tenantId: string): Promise<TenantDTO> {
    return (await this.load(tenantId)).toDTO()
  }

  /** The ones with these ids, in no order; a deleted one, or an id of none, is not there. */
  @UseCase()
  async getMany(ids: string[]): Promise<TenantDTO[]> {
    if (ids.length === 0) return []
    return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(tenant => tenant.toDTO())
  }

  /** Every workspace, newest first, as the staff look them up: only what `TenantFilter` allows. */
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<TenantDTO>> {
    const criteria = filter === undefined ? {} : TenantFilter.toCriteria<TenantRow>(TenantFilter.schema.parse(filter))
    const found = await this.repo.page(criteria, page, { newestFirst: true })
    return mapPage(found, tenant => tenant.toDTO())
  }

  /** The workspaces someone belongs to, the ones they joined last first. */
  @UseCase()
  async listForUser(userId: string, page: PageRequest): Promise<Page<TenantDTO>> {
    const accesses = await this.deps.access.listForUser(userId, page, this.options.productId)
    const tenants = new Map((await this.getMany(accesses.items.flatMap(access => access.tenantId ?? []))).map(tenant => [tenant.id, tenant]))
    // A workspace deleted while this read, or whose accesses its deletion failed to take away (its worker will), is left out.
    return mapPage(accesses, access => tenants.get(access.tenantId!))
  }

  /** Only its admin renames it. */
  @UseCase()
  async rename(tenantId: string, input: unknown): Promise<TenantDTO> {
    const { name } = TenantRenameSchema.parse(input)
    await this.assertAdmin(tenantId)
    const tenant = await this.load(tenantId)
    tenant.rename(name)
    await this.repo.persist(tenant)
    return tenant.toDTO()
  }

  /**
   * Only its admin deletes it. The rest follows from `tenant.deleted`, each part from
   * a worker: its invitations here, its boards in boards, its accesses once more.
   * Its accesses also go at once, after it: it writes to `access` without being a
   * worker, on purpose, so that nobody enters it from the moment it answers. Should
   * that second save fail, its worker takes them away. It never runs again on a
   * conflict: it would find the workspace deleted already.
   */
  @UseCase({ writesTo: ['access'], retryOnConflict: false })
  async delete(tenantId: string): Promise<void> {
    await this.assertAdmin(tenantId)
    const tenant = await this.load(tenantId)
    tenant.delete()
    await this.repo.persist(tenant)
    await this.deps.access.revokeTenant(tenantId)
  }

  /** A new workspace has its admin: what its worker calls, in case `create` stopped halfway. Safe to run again. */
  @UseCase()
  async ensureAdmin(tenant: TenantDTO): Promise<void> {
    await this.admitAdmin(tenant)
  }

  /**
   * A deleted workspace's accesses go: a step of its deletion, from a worker, in case
   * `delete` stopped halfway or someone entered it meanwhile. Safe to run again.
   */
  @UseCase()
  async removeAccesses(tenantId: string): Promise<void> {
    await this.deps.access.revokeTenant(tenantId)
  }

  private admitAdmin(tenant: TenantDTO) {
    return this.deps.access.admit({ userId: tenant.createdBy, productId: this.options.productId, tenantId: tenant.id, role: 'admin' })
  }

  private load(tenantId: string): Promise<Tenant> {
    return this.resolve(() => this.repo.find({ id: tenantId }), () => new TenantNotFound(tenantId))
  }

  /** The signed-in person is its admin. Who is not even a member is told it does not exist. */
  private async assertAdmin(tenantId: string): Promise<void> {
    const access = await this.deps.access.check(currentActor().userId, this.options.productId, tenantId)
    if (!access) throw new TenantNotFound(tenantId)
    if (access.role !== 'admin') throw new NotTenantAdmin()
  }
}
