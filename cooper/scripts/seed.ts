// bun run cooper:seed: cooper's demo data, written through the contexts' use cases as
// anyone would: a staff user with access to the backoffice, and Ana's workspace Acme,
// where Bob joined by accepting her invitation. Safe to run again: what is there stays.
import { runAsActor, type Email } from 'newt/core'
import { config } from '../backend/config'
import { PRODUCTS } from '../backend/contexts/auth/modules/product/product.schema'
import { inWorkspace } from '../backend/contexts/boards/workspace-scope'
import { openContexts, stopContexts } from '../backend/open-contexts'
import { ConsoleMailer } from '../backend/shared/mail/console-mailer'
import type { Mail } from '../backend/shared/mail/mailer'

/** Every demo account's password: it is demo data, on a developer's computer. */
const PASSWORD = 'cooper-demo'

// The emails leave to the console, as in development, and the seed reads Bob's link.
const mails: Mail[] = []
const console_ = new ConsoleMailer(config.mail.from)
const contexts = await openContexts(config, { mailer: { send: async mail => { mails.push(mail); await console_.send(mail) } } })
/**
 * Until the background work is done: auth's jobs first, boards' reactions to auth's
 * events among them (Acme's welcome board), then what those made boards tell.
 */
const settled = async () => {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

try {
  const { user, access, tenant, invitation } = contexts.auth.modules

  /** An account, made the first time. */
  const account = async (email: string, name: string) => (await user.findByEmail(email)) ?? user.signUp({ email, name, password: PASSWORD })

  const staff = await account('staff@cooper.dev', 'Cooper Staff')
  await access.admit({ userId: staff.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })

  const ana = await account('ana@cooper.dev', 'Ana García')
  const bob = await account('bob@cooper.dev', 'Bob Smith')
  const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)

  const anas = await tenant.listForUser(ana.id, { size: 100 })
  const acme = anas.items.find(each => each.name === 'Acme' && each.createdBy === ana.id) ?? await asAna(() => tenant.create({ name: 'Acme' }))

  if (!(await access.check(bob.id, 'cooper', acme.id))) {
    const pending = await asAna(() => invitation.list(acme.id, { size: 100 }))
    const invited = pending.items.find(each => each.email === bob.email) ?? await asAna(() => invitation.create(acme.id, { email: bob.email }))
    // A pending invitation from an earlier run sends its link again.
    if (pending.items.includes(invited)) await invitation.send(invited.id)
    await settled()
    const link = mails.findLast(mail => mail.to === (bob.email as Email))!.text.match(/invitations\/([A-Za-z0-9_-]{43})/)![1]!
    await runAsActor({ userId: bob.id, via: 'web' }, () => invitation.accept(link))
  }
  await settled()

  // A second board, "Launch", made by Ana in Acme as she would from boards' UI.
  const { board, column, card } = contexts.boards.modules
  await asAna(() => inWorkspace(contexts.boards.modules.member, acme.id, async () => {
    if (await board.findByName('Launch')) return
    const launch = await board.create({ name: 'Launch', description: 'Everything left before Acme\'s launch.' })
    const [backlog, doing, review, done] = [
      await column.add(launch.id, { name: 'Backlog' }),
      await column.add(launch.id, { name: 'In progress' }),
      await column.add(launch.id, { name: 'Review' }),
      await column.add(launch.id, { name: 'Done' }),
    ]
    const cards = [
      { columnId: backlog.id, title: 'Write the press release', assigneeId: ana.id },
      { columnId: backlog.id, title: 'Plan the launch party', assigneeId: null },
      { columnId: doing.id, title: 'Finish the pricing page', assigneeId: bob.id },
      { columnId: doing.id, title: 'Record the demo video', assigneeId: ana.id },
      { columnId: review.id, title: 'Check the sign-up emails', assigneeId: bob.id },
      { columnId: done.id, title: 'Pick the launch date', description: 'The first Monday of next month.', assigneeId: ana.id },
    ]
    for (const each of cards) await card.create(launch.id, each)
  }))
  await settled()

  console.log([
    '',
    'cooper is seeded. Every account\'s password is', `  ${PASSWORD}`,
    '',
    `  staff@cooper.dev   the staff: the backoffice, ${config.backoffice.publicUrl}`,
    `  ana@cooper.dev     Acme's admin, ${config.boards.publicUrl}: its boards Welcome and Launch`,
    '  bob@cooper.dev     a member of Acme, who accepted Ana\'s invitation',
    '',
    `  MCP server         ${config.boards.publicUrl}/mcp (OAuth: sign in as Ana or Bob)`,
    '',
  ].join('\n'))
} finally {
  await stopContexts(contexts)
}
