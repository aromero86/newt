import { SqliteStore } from 'newt/adapter-sqlite'
import { Email } from 'newt/contract'
import { eventsOf, now, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: Access) {}
}

/**
 * auth, as `boards`' tests need it: who belongs to each workspace, kept in memory, and
 * auth's events about access, told as auth tells them. Each event is
 * published in a transaction of its own store, so boards' handlers are jobs of its
 * worker, as they are of auth's, and run only on `idle`.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
  }

  readonly access: AccessEvents

  private constructor(private readonly base: Base) {
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

  /** Someone leaves a workspace: `access.revoked`. */
  async revoke(workspaceId: string, userId: string): Promise<void> {
    this.members.get(workspaceId)?.delete(userId)
    await this.tell(new Access_Revoked({ userId, productId: 'cooper', tenantId: workspaceId }))
  }

  /** Until the jobs of its events are done: boards' reactions. */
  idle(): Promise<void> {
    return this.base.jobs.idle()
  }

  close(): Promise<void> {
    return this.base.close()
  }

  private async tell(event: DomainEvent): Promise<void> {
    await this.base.store.transaction(() => this.base.bus.publish(event))
  }
}
