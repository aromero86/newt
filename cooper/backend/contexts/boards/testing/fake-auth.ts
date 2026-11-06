import { SqliteStore } from '@newt-kit/newt/adapter-sqlite'
import { Email } from '@newt-kit/newt/contract'
import { eventsOf, now, type DomainEvent } from '@newt-kit/newt/core'
import { Base } from '@newt-kit/newt/runtime'
import type { Boards_Auth } from '../initialize-modules'
import type { MemberDTO } from '../modules/member/member.schema'

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
 * A module of auth, as boards' tests need it: what they reach of it, and any other use
 * case refused. Those (who signs in, and the routes for workspaces, members and
 * invitations) run on the real auth in cooper's test (`cooper/backend/cooper.test.ts`).
 */
function fakeModule(module: string, reached: object): unknown {
  return new Proxy(reached, {
    get: (target, useCase) => useCase in target
      ? target[useCase as keyof typeof target]
      : () => Promise.reject(new Error(`auth.${module}.${String(useCase)} is not in boards' own tests: cooper.test.ts runs it on the real auth`)),
  })
}

/**
 * auth, as `boards`' tests need it: its modules, with who belongs to each workspace
 * kept in memory, and auth's events about workspaces and access, told as auth tells
 * them. Each event is published in a transaction of its own store, so boards'
 * handlers are jobs of its worker, as they are of auth's, and run only on `idle`.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** auth's modules, as boards is given them: someone with access to a workspace that is there is a member. */
  readonly modules: Boards_Auth

  private constructor(private readonly base: Base) {
    const members = this.members
    this.modules = {
      access: fakeModule('access', {
        check: async (userId: string, _productId: string, tenantId: string | null) => (members.get(tenantId ?? '')?.has(userId) ? { userId, tenantId } : null),
        events: eventsOf(base.bus, { revoked: Access_Revoked }),
      }),
      tenant: fakeModule('tenant', {
        getMany: async (ids: string[]) => ids.filter(id => members.has(id)).map(id => ({ id })),
        events: eventsOf(base.bus, { created: Tenant_Created, deleted: Tenant_Deleted }),
      }),
      user: fakeModule('user', {
        getMany: async (ids: string[]) => ids.flatMap(id => [...members.values()].find(each => each.has(id))?.get(id) ?? []),
      }),
      token: fakeModule('token', {}),
      invitation: fakeModule('invitation', {}),
    } as Boards_Auth
  }

  static async open(): Promise<FakeAuth> {
    return new FakeAuth(new Base({ name: 'auth', store: await SqliteStore.open({ path: ':memory:' }) }))
  }

  /** Someone joins a workspace: `<userId>@cooper.test`, named after their id. */
  join(workspaceId: string, userId: string): MemberDTO {
    const member = { id: userId, name: userId, email: Email.from(`${userId}@cooper.test`), avatarUrl: null }
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
