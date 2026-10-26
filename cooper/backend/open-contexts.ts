import type { Config } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { Backoffice_Context } from './contexts/backoffice/backoffice.context'
import { Boards_Context } from './contexts/boards/boards.context'
import { ConsoleMailer } from './shared/mail/console-mailer'
import type { Mailer } from './shared/mail/mailer'

/** What the contexts are given from outside: the console mailer unless another is. */
export type OpenContextsOptions = {
  mailer?: Mailer
}

/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`, then `backoffice`, which reads both. The
 * server opens them, and so does any script that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  const auth = await Auth_Context.open(config.auth, { mailer })
  const boards = await Boards_Context.open(config.boards, { auth, mailer })
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth, boards })
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
