import { filterSpans, type Clock, type Tracer } from 'newt/core'
import { OtlpTracer } from 'newt/otel'
import type { Config } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { Backoffice_Context } from './contexts/backoffice/backoffice.context'
import { Boards_Context } from './contexts/boards/boards.context'
import { MemoryCardSearch } from './contexts/boards/search/memory-card-search'
import { ConsoleMailer } from './shared/mail/console-mailer'
import { ConsoleTracer } from './shared/observability/console-tracer'
import type { Mailer } from './shared/mail/mailer'

/** What the contexts are given from outside: the console mailer unless another is, and the real time unless a test gives a clock. */
export type OpenContextsOptions = {
  mailer?: Mailer
  clock?: Clock
}

/**
 * The application's tracer, for every context: OpenTelemetry's collector if
 * `COOPER_OTLP_URL` says where it is, else the console if `COOPER_TRACE` asks for it,
 * else none. The worker's own spans (`job.claim` every few seconds, `job.close`…) are
 * left out: what a job does is a use case, and that one is traced.
 */
export function cooperTracer(config: Config): Tracer | undefined {
  const tracer = config.otlpUrl ? new OtlpTracer({ endpoint: config.otlpUrl, service: 'cooper' })
    : config.trace ? new ConsoleTracer() : undefined
  return tracer && filterSpans(tracer, name => !name.startsWith('job.'))
}

/**
 * Every context, each one after those it uses: `auth` first, which every other one
 * signs people in with, then `boards`, then `backoffice`, which reads both. The
 * server opens them, and so does any script that works with their modules (the seed).
 */
export async function openContexts(config: Config, options: OpenContextsOptions = {}) {
  const mailer = options.mailer ?? new ConsoleMailer(config.mail.from)
  const { clock } = options
  const auth = await Auth_Context.open(config.auth, { mailer }, clock)
  const boards = await Boards_Context.open(config.boards, { auth: auth.modules, mailer, search: new MemoryCardSearch(), log: config.trace ? line => console.log(line) : undefined }, clock)
  const backoffice = await Backoffice_Context.open(config.backoffice, { auth: auth.modules, boards: boards.modules }, clock)
  return { auth, boards, backoffice, all: [auth, boards, backoffice] as const }
}

/** The last opened first: a context stops before those it uses. */
export async function stopContexts(contexts: Awaited<ReturnType<typeof openContexts>>): Promise<void> {
  for (const context of contexts.all.toReversed()) await context.stop()
}
