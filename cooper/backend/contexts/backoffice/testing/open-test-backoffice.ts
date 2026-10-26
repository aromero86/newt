import { runAsActor } from 'newt/core'
import { config, type Config } from '../../../config'
import { openContexts, stopContexts, type OpenContextsOptions } from '../../../open-contexts'
import { PRODUCTS } from '../../auth/modules/product/product.schema'
import type { UserDTO } from '../../auth/modules/user/user.schema'
import { runInWorkspace } from '../../boards/workspace-scope'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: 0 },
    boards: { ...config.boards, database: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
  }
}

/**
 * The backoffice for a test, with the real auth and boards it reads, as the server
 * opens them: every database in memory, the emails in a list. The data is made
 * through auth's and boards' own use cases, as anyone would. A test that moves the
 * time gives every context its `clock`.
 */
export async function openTestBackoffice(options: Pick<OpenContextsOptions, 'clock'> = {}) {
  const contexts = await openContexts(testConfig(), { mailer: { send: async () => {} }, ...options })
  const { auth, boards, backoffice } = contexts

  /** An account, as someone signs up in auth. */
  const signUp = (name: string): Promise<UserDTO> =>
    auth.modules.user.signUp({ email: `${name.toLowerCase()}@cooper.test`, name, password: 'a long password' })

  return {
    auth,
    boards,
    backoffice,
    modules: backoffice.modules,
    signUp,
    /** Someone of the staff, as the seed makes the first one. */
    async staffMember(name: string): Promise<UserDTO> {
      const user = await signUp(name)
      await auth.modules.access.admit({ userId: user.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
      return user
    },
    as<T>(user: UserDTO, fn: () => Promise<T>): Promise<T> {
      return runAsActor({ userId: user.id, via: 'web' }, fn)
    },
    /** A board with a column, made in a workspace by someone of it, with cards titled as given. */
    async board(user: UserDTO, workspaceId: string, name: string, cards: string[]) {
      return runAsActor({ userId: user.id, via: 'web' }, () => runInWorkspace(workspaceId, async () => {
        const board = await boards.modules.board.create({ name })
        const column = await boards.modules.column.add(board.id, { name: 'To do' })
        for (const title of cards) await boards.modules.card.create(board.id, { columnId: column.id, title })
        return board
      }))
    },
    /**
     * Until the background work is done, in the order it flows: auth's events (heard
     * by boards), then boards'.
     */
    async settled(): Promise<void> {
      for (let round = 0; round < 2; round++) {
        for (const context of contexts.all) await context.base.jobs.idle()
      }
    },
    close: () => stopContexts(contexts),
  }
}

export type TestBackoffice = Awaited<ReturnType<typeof openTestBackoffice>>
