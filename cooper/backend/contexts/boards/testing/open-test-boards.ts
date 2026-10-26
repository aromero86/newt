import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its files in a folder of its own, removed as it closes, a fake
 * auth behind its ports, and who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
  const boards = await Boards_Context.open({ ...config.boards, folder, port: 0 }, {
    workspaces: auth.workspaces,
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    folder,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    async close(): Promise<void> {
      await boards.stop()
      await rm(folder, { recursive: true, force: true })
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
