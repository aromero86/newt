import type { Tracer } from 'newt/core'
import type { Config } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { WORKSPACES_PRODUCT } from './contexts/auth/modules/product/product.schema'
import { Backoffice_Context } from './contexts/backoffice/backoffice.context'
import { Boards_Context } from './contexts/boards/boards.context'
import type { Boards_ModuleDeps } from './contexts/boards/initialize-modules'
import { ConsoleMailer } from './shared/mail/console-mailer'
import { ConsoleTracer } from './shared/observability/console-tracer'
import type { Mailer } from './shared/mail/mailer'

/**
 * What the contexts are given from outside: the console mailer unless another is,
 * and the console tracer if `COOPER_TRACE` asks for one, unless another is given.
 */
export type OpenContextsOptions = {
  mailer?: Mailer
  tracer?: Tracer
}

/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`, then `backoffice`, which reads both. The
 * server opens them, and so does any script that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  // One tracer for every context: a use case that calls another context's shows that
  // call inside it, since they run in one process.
  const tracer = options.tracer ?? (config.trace ? new ConsoleTracer() : undefined)
  const auth = await Auth_Context.open(config.auth, { mailer }, tracer)
  const boards = await Boards_Context.open(config.boards, { ...boardsOnAuth(auth), mailer, log: tracer && (line => console.log(line)) }, tracer)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, tracer)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}

/**
 * What `boards` asks of auth, wired to auth's use cases and events. A workspace is a
 * tenant of the product `cooper`, and its members are those with access to it while
 * it is there.
 * boards' reactions to auth's events are subscribed on auth's emitters: they are jobs
 * of auth's outbox, run by auth's worker (`auth.base.jobs.idle()`, then boards').
 */
function boardsOnAuth(auth: Auth_Context): Omit<Boards_ModuleDeps, 'mailer' | 'log'> {
  const { access, user, tenant, token, invitation } = auth.modules
  // A deleted tenant is not among them.
  const exists = async (workspaceId: string) => (await tenant.getMany([workspaceId])).length > 0
  // An access and a tenant still there: a deleted workspace's accesses go a moment
  // after it (or, should that fail, from its worker), and nobody enters it meanwhile.
  const isMember = async (workspaceId: string, userId: string) => {
    const [granted, alive] = await Promise.all([access.check(userId, WORKSPACES_PRODUCT, workspaceId), exists(workspaceId)])
    return granted !== null && alive
  }
  return {
    workspaces: {
      isMember,
      member: async (workspaceId, userId) => {
        if (!await isMember(workspaceId, userId)) return null
        const [found] = await user.getMany([userId])
        return found ? { id: found.id, name: found.name, email: found.email } : null
      },
      exists,
    },
    tenants: tenant.events,
    access: access.events,
    auth: { token, user, tenant, access, invitation },
  }
}

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
