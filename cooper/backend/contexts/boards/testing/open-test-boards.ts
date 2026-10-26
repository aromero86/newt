import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../../../config'
import { Boards_Context } from '../boards.context'

/**
 * `boards` for a test: its files in a folder of its own, removed as it closes, and
 * who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
  const boards = await Boards_Context.open({ ...config.boards, folder, port: 0 })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId } : null
  })
  return {
    boards,
    modules: boards.modules,
    folder,
    async close(): Promise<void> {
      await boards.stop()
      await rm(folder, { recursive: true, force: true })
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
