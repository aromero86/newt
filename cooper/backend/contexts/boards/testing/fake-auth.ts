import { SqliteStore } from 'newt/adapter-sqlite'
import { Email } from 'newt/contract'
import { eventsOf, now, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { Boards_Auth } from '../initialize-modules'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'
import type { TenantEvents } from '../modules/workspace/workspace.deps'

class Tenant_Created implements DomainEvent<{ id: string }> {
  static readonly eventName = 'tenant.created'
  readonly name = Tenant_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

class Tenant_Deleted implements DomainEvent<{ id: string }> {
  static readonly eventName = 'tenant.deleted'
  readonly name = Tenant_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: Access) {}
}

/**
 * auth, as `boards`' tests need it: who belongs to each workspace, kept in memory, and
 * auth's events about workspaces and access, told as auth tells them. Each event is
 * published in a transaction of its own store, so boards' handlers are jobs of its
 * worker, as they are of auth's, and run only on `idle`.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
    exists: async workspaceId => this.members.has(workspaceId),
  }

  readonly tenants: TenantEvents
  readonly access: AccessEvents

  /**
   * auth's use cases, which boards' own tests never reach: who signs in, and the
   * routes for workspaces, members and invitations, which run on the real auth in
   * cooper's test (`cooper/backend/cooper.test.ts`). Any call says so.
   */
  readonly modules = new Proxy({}, {
    get: (_, module) => new Proxy({}, {
      get: (__, useCase) => () => Promise.reject(new Error(`auth.${String(module)}.${String(useCase)} is not in boards' own tests: cooper.test.ts runs it on the real auth`)),
    }),
  }) as Boards_Auth

  private constructor(private readonly base: Base) {
    this.tenants = eventsOf(base.bus, { created: Tenant_Created, deleted: Tenant_Deleted })
    this.access = eventsOf(base.bus, { revoked: Access_Revoked })
  }

  static async open(): Promise<FakeAuth> {
    return new FakeAuth(new Base({ name: 'auth', store: await SqliteStore.open({ path: ':memory:' }) }))
  }

  /** Someone joins a workspace: `<userId>@cooper.test`, named after their id. */
  join(workspaceId: string, userId: string): MemberDTO {
    const member = { id: userId, name: userId, email: Email.from(`${userId}@cooper.test`) }
    const members = this.members.get(workspaceId) ?? new Map<string, MemberDTO>()
    members.set(userId, member)
    this.members.set(workspaceId, members)
    return member
  }

  /** A workspace is created, with its creator in it: `tenant.created`. */
  async createWorkspace(workspaceId: string, creatorId: string): Promise<void> {
    this.join(workspaceId, creatorId)
    await this.tell(new Tenant_Created({ id: workspaceId }))
  }

  /**
   * `tenant.created` told again, and nobody joins: as a job of it run late, after its
   * workspace is gone.
   */
  async tellCreatedAgain(workspaceId: string): Promise<void> {
    await this.tell(new Tenant_Created({ id: workspaceId }))
  }

  /** A workspace is deleted, and nobody belongs to it any more: `tenant.deleted`. */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.members.delete(workspaceId)
    await this.tell(new Tenant_Deleted({ id: workspaceId }))
  }

  /** Someone leaves a workspace: `access.revoked`. */
  async revoke(workspaceId: string, userId: string): Promise<void> {
    this.members.get(workspaceId)?.delete(userId)
    await this.tell(new Access_Revoked({ userId, productId: 'cooper', tenantId: workspaceId }))
  }

  /** Until the jobs of its events are done: boards' reactions. */
  idle(): Promise<void> {
    return this.base.jobs.idle()
  }

  /** The jobs of its events, as they stand: to see one that failed. */
  jobs() {
    return this.base.store.outbox.list()
  }

  close(): Promise<void> {
    return this.base.close()
  }

  private async tell(event: DomainEvent): Promise<void> {
    await this.base.store.transaction(() => this.base.bus.publish(event))
  }
}
