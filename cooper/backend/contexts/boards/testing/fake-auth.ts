import { Email } from 'newt/contract'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'

/**
 * auth, as `boards` needs it before there is one: who belongs to each workspace,
 * kept in memory.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
  }

  private constructor() {}

  static async open(): Promise<FakeAuth> {
    return new FakeAuth()
  }

  /** Someone joins a workspace: `<userId>@cooper.test`, named after their id. */
  join(workspaceId: string, userId: string): MemberDTO {
    const member = { id: userId, name: userId, email: Email.from(`${userId}@cooper.test`) }
    const members = this.members.get(workspaceId) ?? new Map<string, MemberDTO>()
    members.set(userId, member)
    this.members.set(workspaceId, members)
    return member
  }
}
