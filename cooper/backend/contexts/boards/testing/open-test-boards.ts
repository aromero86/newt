import { runAsActor } from '@newt-kit/newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { RecordingMailer } from '../../../shared/mail/recording-mailer'
import type { BoardsBase } from '../boards-base'
import { Boards_Context } from '../boards.context'
import type { CardRow } from '../modules/card/card.repository'
import { MemoryCardSearch } from '../search/memory-card-search'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database and its cards' search in memory, a fake auth's
 * modules, its emails and its log's lines in lists, and who sends a request
 * told by an `x-user` header (the real authenticator, the web session's, is replaced).
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mailer = new RecordingMailer()
  const lines: string[] = []
  const search = new MemoryCardSearch()
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    auth: auth.modules,
    mailer,
    search,
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
    mails: mailer.mails,
    lines,
    search,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    /** Cards written as rows, past what any use case would let in and its events: for a test of very many. */
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
