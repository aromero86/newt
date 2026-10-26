import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import type { Mail } from '../../../shared/mail/mailer'
import type { BoardsBase } from '../boards-base'
import { Boards_Context } from '../boards.context'
import type { CardRow } from '../modules/card/card.repository'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, its
 * emails and its log's lines in lists, and who sends a request told by an `x-user` header (the real
 * authenticator, the web session's, is replaced).
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mails: Mail[] = []
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, dbPath: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    auth: auth.modules,
    mailer: { send: async mail => { mails.push(mail) } },
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    mails,
    lines,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    /** Cards written as rows, past what any use case would let in: for a test of very many. */
    async writeCards(rows: CardRow[]): Promise<void> {
      const { store, db } = boards.base as BoardsBase
      await store.transaction(async () => {
        for (let i = 0; i < rows.length; i += 500) await db.insertInto('card').values(rows.slice(i, i + 500)).execute()
      })
    },
    /** Until the background work is done: auth's events heard, and what they made boards tell. */
    async settled(): Promise<void> {
      await auth.idle()
      await boards.base.jobs.idle()
    },
    async close(): Promise<void> {
      await boards.stop()
      await auth.close()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
