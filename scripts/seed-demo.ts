// Loads Acme Shop, a realistic example product, into the database NEWT_DB_PATH
// points at: a demo account, its workspace, dimensions, areas, features, rules and
// proposals in every state. Running it again overwrites Acme Shop: everything inside
// the workspace is wiped and loaded anew, keeping the account, the workspace's id and
// its members. Nothing else in the database is touched. The wipe is plain SQL, as
// a dev tool; loading goes through the modules' use cases.
import { Base } from '../src/backend/base/base'
import { config } from '../src/backend/config'
import { runAsActor } from '../src/backend/core/context/run-as-actor'
import { initializeModules } from '../src/backend/initialize-modules'
import type { DeltaInputDTO } from '../src/backend/modules/delta/delta.schema'
import type { RuleDraftDTO } from '../src/backend/modules/rule/rule.schema'

const DEMO = { nick: 'demo', fullName: 'Demo Person', email: 'demo@acme.shop', password: 'acme-shop-demo' }

const WORKSPACE = { name: 'Acme Shop', description: 'The online shop: mobile app, web and backoffice, in Spain and Mexico.' }

const DIMENSIONS = {
  Surface: ['Mobile app', 'Web', 'Backoffice'],
  Role: ['Guest', 'Customer', 'Admin'],
  Market: ['Spain', 'Mexico'],
}

type Scope = Partial<Record<keyof typeof DIMENSIONS, string[]>>
type DemoRule = Omit<RuleDraftDTO, 'scope'> & {
  scope?: Scope
  /** Earlier versions, oldest first: the rule is created with them and then replaced. */
  before?: (Omit<RuleDraftDTO, 'scope'> & { scope?: Scope })[]
  retired?: boolean
}

const AREAS: { name: string, description: string, features: { name: string, description: string, rules: DemoRule[] }[] }[] = [
  {
    name: 'Purchase',
    description: 'From the cart to a paid order. Not what happens after payment: see Shipping and Refunds.',
    features: [
      {
        name: 'Checkout',
        description: 'Turning a cart into a paid order: address, payment method and confirmation.\nNot the cart itself, nor how each payment method works.',
        rules: [
          {
            kind: 'validation',
            statement: 'An order needs at least one item and a shipping address',
            why: 'Without them the order cannot be delivered.',
            criteria: [{ given: 'an empty cart', when: 'the person goes to pay', then: 'payment is not offered and the cart asks for an item' }],
          },
          {
            kind: 'permission',
            statement: 'Guests cannot pay more than 500 € in one order',
            why: 'High amounts from unknown people carry most of the fraud. Above the limit, an account makes the buyer known.',
            scope: { Role: ['Guest'] },
            criteria: [
              { given: 'a guest with a cart of 650 €', when: 'they go to pay', then: 'they are asked to sign in or sign up' },
              { given: 'a guest with a cart of 120 €', when: 'they go to pay', then: 'they pay as a guest' },
            ],
            before: [{
              kind: 'permission',
              statement: 'Guests cannot pay more than 300 € in one order',
              why: 'High amounts from unknown people carry most of the fraud.',
              scope: { Role: ['Guest'] },
            }],
          },
          {
            kind: 'flow',
            statement: 'Guests check out with an email address, without creating an account',
            why: 'Asking for an account before paying loses many first purchases.',
            scope: { Role: ['Guest'] },
            criteria: [{ given: 'a guest with items in the cart', when: 'they go to pay', then: 'they are asked for an email address and can pay without a password' }],
          },
          {
            kind: 'permission',
            statement: 'Only registered customers can pay in installments',
            why: 'The bank checks who pays in installments, so the buyer must be known.',
            criteria: [{ given: 'a guest with a cart of 200 €', when: 'they choose how to pay', then: 'installments are not offered, with a link to sign up' }],
          },
          {
            kind: 'calculation',
            statement: 'Prices are shown with VAT included',
            why: 'Spanish consumer law requires the final price to be visible.',
            scope: { Market: ['Spain'] },
          },
          {
            kind: 'calculation',
            statement: 'Prices are shown with 16% IVA included',
            why: 'Mexican consumers expect, and the law requires, the final price.',
            scope: { Market: ['Mexico'] },
          },
          {
            kind: 'flow',
            statement: 'A paid order cannot change its amount',
            why: 'What was charged must match the order: any change is a refund or a new order.',
            criteria: [{ given: 'a paid order of 80 €', when: 'an item is removed', then: 'the order keeps its amount and a refund of that item is created' }],
          },
        ],
      },
      {
        name: 'Pay with Bizum',
        description: 'Paying with Bizum from a Spanish phone. Not refunds to Bizum: see Refunds.',
        rules: [
          {
            kind: 'permission',
            statement: 'Bizum is only offered in Spain, in the app and on the web',
            why: 'Bizum only works with Spanish bank accounts.',
            scope: { Market: ['Spain'], Surface: ['Mobile app', 'Web'] },
          },
          {
            kind: 'validation',
            statement: 'A Bizum payment needs a Spanish mobile number',
            why: 'Bizum identifies the payer by a +34 mobile number.',
            scope: { Market: ['Spain'] },
            criteria: [{ given: 'the number +52 55 1234 5678', when: 'the person pays with Bizum', then: 'the number is rejected before contacting Bizum' }],
          },
          {
            kind: 'non-functional',
            statement: 'A Bizum payment is confirmed or rejected within 30 seconds',
            why: 'Longer waits make people pay twice or abandon the order.',
          },
          {
            kind: 'legal',
            statement: 'Bizum payments are capped at 1000 €',
            why: 'The bank capped Bizum purchases; it no longer does.',
            scope: { Market: ['Spain'] },
            retired: true,
          },
        ],
      },
      {
        name: 'Shipping',
        description: 'How a paid order reaches the customer, and what it costs.',
        rules: [
          {
            kind: 'calculation',
            statement: 'Shipping is free for orders over 50 €',
            why: 'It lifts the average order above the cost of shipping.',
            scope: { Market: ['Spain'] },
            criteria: [{ given: 'an order of 49,99 € in Spain', when: 'the shipping cost is shown', then: 'it is 4,95 €' }],
          },
          {
            kind: 'flow',
            statement: 'A shipped order cannot be cancelled, only returned',
            why: 'Once with the carrier, the warehouse cannot stop it.',
          },
        ],
      },
    ],
  },
  {
    name: 'Account',
    description: 'Who the customer is and what they did: signing up, their data and their orders.',
    features: [
      {
        name: 'Sign up',
        description: 'Creating a customer account. Not signing up admins: they are created in the backoffice.',
        rules: [
          {
            kind: 'validation',
            statement: 'An email belongs to one account at most',
            why: 'The email is how a customer signs in and recovers their account.',
          },
          {
            kind: 'legal',
            statement: 'Signing up requires accepting the privacy policy',
            why: 'GDPR: personal data needs explicit consent.',
            scope: { Surface: ['Mobile app', 'Web'] },
          },
        ],
      },
      {
        name: 'Order history',
        description: 'A customer\'s past orders, with their state and invoices.',
        rules: [
          {
            kind: 'permission',
            statement: 'Customers only see their own orders',
            why: 'Orders hold addresses and payments: they are personal data.',
            scope: { Role: ['Customer'] },
          },
        ],
      },
    ],
  },
  {
    name: 'Backoffice',
    description: 'What the shop\'s team does: refunds and the catalog. Not what customers see.',
    features: [
      {
        name: 'Refunds',
        description: 'Giving money back for an order, in full or in part.',
        rules: [
          {
            kind: 'permission',
            statement: 'Only admins can issue refunds',
            why: 'A refund moves money out of the shop.',
            scope: { Surface: ['Backoffice'], Role: ['Admin'] },
          },
          {
            kind: 'flow',
            statement: 'A refund goes back to the original payment method',
            why: 'Payment providers and anti-fraud rules require it.',
          },
        ],
      },
      { name: 'Catalog', description: 'The products on sale, their prices and stock.', rules: [] },
    ],
  },
]

/** What a proposal's deltas point at: the definition just loaded, by name. */
type Refs = {
  area: (name: string) => string
  feature: (name: string) => string
  /** The id of a rule by its key: R-10. */
  rule: (key: string) => string
  /** A dimension as a delta changes it: its name and every value. */
  dimension: (name: string) => { id: string, state: { name: string, values: { id: string, name: string, retired: boolean }[] } }
  value: (dimension: string, value: string) => { dimensionId: string, valueIds: string[] }
}

/** One delta, written once the deltas before it exist: `created` holds the ids of what they create, in order. */
type DemoDelta = (refs: Refs, created: string[]) => DeltaInputDTO

type DemoProposal = {
  title: string
  /** Its document, in Markdown. */
  document: string
  /** Where the lifecycle leaves it. */
  status: 'draft' | 'in review' | 'accepted' | 'merged'
  deltas: DemoDelta[]
  /** The deltas rejected, by index, and why. Once in review, the rest are approved. */
  rejected?: Record<number, string>
  /** Revisions published after the reviews: a new document, deltas written again by index, or both. */
  iterations?: { message: string, document?: string, rewrite?: Record<number, DemoDelta> }[]
}

const PROPOSALS: DemoProposal[] = [
  {
    title: 'Sell in Portugal, with gift cards',
    document: `## Context

Portugal is our third market by visits, and we do not sell there yet.

## Decisions

- **Portugal** becomes a value of *Market*.
- **Gift cards** come with it: they are what Portuguese customers ask for most.
`,
    status: 'merged',
    deltas: [
      refs => {
        const market = refs.dimension('Market')
        return { kind: 'dimension', operation: 'change', targetId: market.id, after: { ...market.state, values: [...market.state.values, { name: 'Portugal', retired: false }] } }
      },
      refs => ({
        kind: 'feature',
        operation: 'create',
        after: { areaId: refs.area('Purchase'), name: 'Gift cards', description: 'Buying a gift card and paying with one. Not refunds to a gift card: see Refunds.' },
      }),
      (_, created) => ({
        kind: 'rule',
        operation: 'create',
        after: {
          featureId: created[0]!,
          kind: 'legal',
          statement: 'A gift card can be used for 12 months after it is bought',
          why: 'Consumer law sets the minimum validity of prepaid cards.',
          criteria: [{ given: 'a gift card bought 13 months ago', when: 'the customer pays with it', then: 'it is refused as expired' }],
        },
      }),
    ],
  },
  {
    title: 'Free shipping from 40 €',
    document: `## Problem

Half the carts in Spain stop between 40 € and 50 €: the shipping cost is what is left.

## Decision

Free shipping from **40 €**, and the threshold shown in the cart.
`,
    status: 'accepted',
    deltas: [
      refs => ({
        kind: 'rule',
        operation: 'change',
        targetId: refs.rule('R-12'),
        after: {
          kind: 'calculation',
          statement: 'Shipping is free for orders over 40 €',
          why: 'Most carts sit between 40 and 50 €: free shipping there lifts conversion more than it costs.',
          scope: [refs.value('Market', 'Spain')],
          criteria: [{ given: 'an order of 39,99 € in Spain', when: 'the shipping cost is shown', then: 'it is 4,95 €' }],
        },
      }),
      refs => ({
        kind: 'rule',
        operation: 'create',
        after: {
          featureId: refs.feature('Shipping'),
          kind: 'flow',
          statement: 'Orders paid before 14:00 leave the warehouse the same day',
          why: 'Same-day dispatch is what makes free shipping worth waiting for.',
          scope: [refs.value('Market', 'Spain')],
        },
      }),
    ],
  },
  {
    title: 'Pay in three installments',
    document: `## Context

Customers ask to split big orders. A financing provider pays us at once and charges them in three months.

## Open questions

- Which minimum does the provider accept?
`,
    status: 'in review',
    deltas: [
      refs => ({
        kind: 'feature',
        operation: 'create',
        after: { areaId: refs.area('Purchase'), name: 'Pay in installments', description: 'Splitting the payment of an order in three monthly installments, through a financing provider.' },
      }),
      (refs, created) => ({
        kind: 'rule',
        operation: 'create',
        after: {
          featureId: created[0]!,
          kind: 'validation',
          statement: 'Installments are offered for orders over 90 €',
          why: 'Below that, the provider\'s fee eats the margin.',
          scope: [refs.value('Role', 'Customer')],
        },
      }),
    ],
    rejected: { 1: 'The provider\'s minimum is 120 €: below that it refuses the financing.' },
    iterations: [
      {
        message: 'Raise the minimum to 120 €, the provider\'s floor',
        rewrite: {
          1: (refs, created) => ({
            kind: 'rule',
            operation: 'create',
            after: {
              featureId: created[0]!,
              kind: 'validation',
              statement: 'Installments are offered for orders over 120 €',
              why: 'It is the provider\'s minimum: below that it refuses the financing.',
              scope: [refs.value('Role', 'Customer')],
            },
          }),
        },
      },
      {
        message: 'Answer the open question',
        document: `## Context

Customers ask to split big orders. A financing provider pays us at once and charges them in three months.

## Decisions

- The provider's minimum is **120 €**: installments start there.
`,
      },
    ],
  },
  {
    title: 'Delete my account',
    document: `## Problem

Customers write to support to have their account deleted: it takes days and it is manual.
`,
    status: 'draft',
    deltas: [
      refs => ({
        kind: 'feature',
        operation: 'create',
        after: { areaId: refs.area('Account'), name: 'Account deletion', description: 'A customer deletes their account and their personal data. Not their orders, which the law keeps.' },
      }),
      (_, created) => ({
        kind: 'rule',
        operation: 'create',
        after: {
          featureId: created[0]!,
          kind: 'legal',
          statement: 'Deleting an account erases its personal data within 30 days',
          why: 'GDPR: the right to erasure.',
          criteria: [{ given: 'a customer who deletes their account', when: '30 days have passed', then: 'their name, email and addresses are gone' }],
        },
      }),
    ],
  },
]

const base = await Base.open(config)
const modules = await initializeModules(base)

try {
  const { token } = (await modules.user.find({ login: DEMO.nick })).length > 0
    ? await modules.authSession.signIn({ login: DEMO.nick, password: DEMO.password })
    : await modules.authSession.signUp(DEMO)
  const actor = (await modules.authSession.authenticate(token))!
  const overwritten = await runAsActor(actor, seed)
  // Its words can be searched at once; the server computes their meaning on the first search.
  await modules.search.reindex((await runAsActor(actor, acmeShop))!.id)
  console.log(`Acme Shop ${overwritten ? 'overwritten' : 'loaded'} in ${config.dbPath}. Sign in as ${DEMO.nick} / ${DEMO.password}`)
} finally {
  // Let the workers that react to a new account finish before closing.
  await Bun.sleep(300)
  base.close()
  // The search module keeps working in the background: nothing here waits for it.
  process.exit(0)
}

/** Resolves to whether Acme Shop was already there, and so overwritten. */
async function seed(): Promise<boolean> {
  const existing = await acmeShop()
  const workspace = existing ?? await modules.workspace.create(WORKSPACE)
  if (existing) {
    wipe(existing.id)
    if (existing.archivedAt) await modules.workspace.unarchive(existing.id)
    await modules.workspace.update(existing.id, WORKSPACE)
  }

  const values = new Map<string, { dimensionId: string, valueId: string }>()
  for (const [name, valueNames] of Object.entries(DIMENSIONS)) {
    let dimension = await modules.dimension.create(workspace.id, { name })
    for (const valueName of valueNames) dimension = await modules.dimension.addValue(workspace.id, dimension.id, { name: valueName })
    for (const value of dimension.values) values.set(`${name}:${value.name}`, { dimensionId: dimension.id, valueId: value.id })
  }
  const scopeOf = (scope: Scope = {}) => Object.entries(scope).map(([dimension, names]) => {
    const picked = names.map(name => values.get(`${dimension}:${name}`)!)
    return { dimensionId: picked[0]!.dimensionId, valueIds: picked.map(value => value.valueId) }
  })

  const areaIds = new Map<string, string>()
  const featureIds = new Map<string, string>()
  for (const area of AREAS) {
    const { id: areaId } = await modules.featureArea.create(workspace.id, { name: area.name, description: area.description })
    areaIds.set(area.name, areaId)
    for (const feature of area.features) {
      const { id: featureId } = await modules.feature.create(workspace.id, { areaId, name: feature.name, description: feature.description })
      featureIds.set(feature.name, featureId)
      for (const { before = [], retired, scope, ...draft } of feature.rules) {
        const [first, ...rest] = [...before, { ...draft, scope }]
        const rule = await modules.rule.create(workspace.id, { ...first!, featureId, scope: scopeOf(first!.scope) })
        for (const version of rest) await modules.rule.supersede(workspace.id, rule.key, { ...version, scope: scopeOf(version.scope) })
        if (retired) await modules.rule.retire(workspace.id, rule.key)
      }
    }
  }

  // The definition as it starts is the first release; the merged proposal makes the second.
  await modules.release.publish(workspace.id, { name: 'v2.3.0', description: 'The shop as it is: checkout, Bizum, shipping, accounts and the backoffice.' })

  // Each proposal sees the definition as the ones before it left it.
  for (const proposal of PROPOSALS) {
    const dimensions = await modules.dimension.list(workspace.id)
    const ruleIds = new Map((await modules.rule.find(workspace.id, {})).map(rule => [rule.key, rule.id]))
    const refs: Refs = {
      area: name => areaIds.get(name)!,
      feature: name => featureIds.get(name)!,
      rule: key => ruleIds.get(key)!,
      dimension: name => {
        const dimension = dimensions.find(each => each.name === name)!
        return { id: dimension.id, state: { name, values: dimension.values.map(value => ({ id: value.id, name: value.name, retired: value.retiredAt !== null })) } }
      },
      value: (dimension, value) => {
        const { dimensionId, valueId } = values.get(`${dimension}:${value}`)!
        return { dimensionId, valueIds: [valueId] }
      },
    }
    await propose(workspace.id, proposal, refs)
    if (proposal.status === 'merged') await modules.release.publish(workspace.id, { name: 'v2.4.0', description: 'Portugal and gift cards.' })
  }

  // A small change merged after the last release: what the next one would publish.
  const r10 = (await modules.rule.find(workspace.id, {})).find(rule => rule.key === 'R-10')!
  const quick = await modules.proposal.quick(workspace.id, {
    delta: {
      kind: 'rule',
      operation: 'change',
      targetId: r10.id,
      after: { ...r10.current, statement: 'A Bizum payment is confirmed or rejected within 20 seconds', why: 'Since the bank moved to instant payments, 30 seconds is too long to wait.' },
    },
  })
  const [delta] = (await modules.proposal.deltas(workspace.id, quick.key, 'published', { size: 1 })).items
  await modules.proposal.reviewDelta(workspace.id, quick.key, delta!.id, { verdict: 'approved' })
  await modules.proposal.accept(workspace.id, quick.key)
  await modules.proposal.merge(workspace.id, quick.key)
  return existing !== undefined
}

/** Takes a proposal through its lifecycle as far as its status says. */
async function propose(workspaceId: string, proposal: DemoProposal, refs: Refs): Promise<void> {
  const { key } = await modules.proposal.create(workspaceId, { title: proposal.title })
  await modules.proposal.writeDocument(workspaceId, key, { document: proposal.document })
  const created: string[] = []
  const deltaIds: string[] = []
  for (const write of proposal.deltas) {
    const delta = write(refs, created)
    const added = await modules.proposal.addDelta(workspaceId, key, delta)
    if (delta.operation === 'create') created.push(added.targetId)
    deltaIds.push(added.id)
  }
  if (proposal.status === 'draft') return

  await modules.proposal.submit(workspaceId, key, { message: 'First revision' })
  for (const [index, deltaId] of deltaIds.entries()) {
    const reason = proposal.rejected?.[index]
    await modules.proposal.reviewDelta(workspaceId, key, deltaId, reason ? { verdict: 'rejected', reason } : { verdict: 'approved' })
  }
  // Each iteration is a revision: the deltas it does not touch keep their verdicts.
  for (const iteration of proposal.iterations ?? []) {
    if (iteration.document) await modules.proposal.writeDocument(workspaceId, key, { document: iteration.document })
    for (const [index, write] of Object.entries(iteration.rewrite ?? {})) {
      await modules.proposal.rewriteDelta(workspaceId, key, deltaIds[Number(index)]!, write(refs, created))
    }
    await modules.proposal.publish(workspaceId, key, { message: iteration.message })
  }
  if (proposal.status === 'in review') return

  await modules.proposal.accept(workspaceId, key)
  if (proposal.status === 'merged') await modules.proposal.merge(workspaceId, key)
}

/** The demo account's Acme Shop, if it has one. */
async function acmeShop() {
  for (let cursor: string | undefined; ;) {
    const page = await modules.workspace.mine({ size: 100, cursor })
    const found = page.items.find(workspace => workspace.name === WORKSPACE.name && workspace.myRole === 'admin')
    if (found || !page.hasMore) return found
    cursor = page.items.at(-1)!.id
  }
}

/** Everything inside the workspace, in one transaction and in foreign-key order. Its members stay. */
function wipe(workspaceId: string): void {
  const sqlite = base.db.sqlite
  sqlite.transaction(() => {
    for (const statement of [
      'DELETE FROM search_entry_text WHERE entry_id IN (SELECT id FROM search_entry WHERE workspace_id = ?1)',
      'DELETE FROM search_entry WHERE workspace_id = ?1',
      'DELETE FROM release__artifact WHERE release_id IN (SELECT id FROM release WHERE workspace_id = ?1)',
      'DELETE FROM release WHERE workspace_id = ?1',
      'DELETE FROM discussion_comment WHERE workspace_id = ?1',
      'DELETE FROM discussion WHERE workspace_id = ?1',
      'DELETE FROM delta__review WHERE delta_id IN (SELECT id FROM delta WHERE workspace_id = ?1)',
      'DELETE FROM delta__snapshot WHERE delta_id IN (SELECT id FROM delta WHERE workspace_id = ?1)',
      'DELETE FROM delta WHERE workspace_id = ?1',
      'DELETE FROM proposal__revision WHERE proposal_id IN (SELECT id FROM proposal WHERE workspace_id = ?1)',
      'DELETE FROM proposal WHERE workspace_id = ?1',
      'DELETE FROM rule__scope WHERE version_id IN (SELECT v.id FROM rule__version v JOIN rule r ON r.id = v.rule_id WHERE r.workspace_id = ?1)',
      'DELETE FROM rule__version WHERE rule_id IN (SELECT id FROM rule WHERE workspace_id = ?1)',
      'DELETE FROM rule WHERE workspace_id = ?1',
      'DELETE FROM feature WHERE workspace_id = ?1',
      'DELETE FROM feature_area WHERE workspace_id = ?1',
      'DELETE FROM dimension__value WHERE dimension_id IN (SELECT id FROM dimension WHERE workspace_id = ?1)',
      'DELETE FROM dimension WHERE workspace_id = ?1',
    ]) sqlite.run(statement, [workspaceId])
  })()
}
