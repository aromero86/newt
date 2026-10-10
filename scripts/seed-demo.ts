// Loads Acme Shop, a realistic example product, into the database NEWT_DB_PATH
// points at: a demo account, its workspace, dimensions, areas, features and rules.
// Everything goes through the modules' use cases. It stops if the demo account
// already exists, so running it twice changes nothing.
import { Base } from '../src/backend/base/base'
import { config } from '../src/backend/config'
import { runAsActor } from '../src/backend/core/context/run-as-actor'
import { initializeModules } from '../src/backend/initialize-modules'
import type { RuleDraftDTO } from '../src/backend/modules/rule/rule.schema'

const DEMO = { nick: 'demo', fullName: 'Demo Person', email: 'demo@acme.shop', password: 'acme-shop-demo' }

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

const base = await Base.open(config)
const modules = await initializeModules(base)

try {
  if ((await modules.user.find({ login: DEMO.nick })).length > 0) {
    console.log(`The demo account (@${DEMO.nick}) already exists in ${config.dbPath}: nothing to do.`)
  } else {
    const { token } = await modules.authSession.signUp(DEMO)
    const actor = (await modules.authSession.authenticate(token))!
    await runAsActor(actor, seed)
    console.log(`Acme Shop loaded into ${config.dbPath}. Sign in as ${DEMO.nick} / ${DEMO.password}`)
  }
} finally {
  // Let the workers that react to the new account finish before closing.
  await Bun.sleep(300)
  base.close()
}

async function seed() {
  const workspace = await modules.workspace.create({ name: 'Acme Shop', description: 'The online shop: mobile app, web and backoffice, in Spain and Mexico.' })

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

  for (const area of AREAS) {
    const { id: areaId } = await modules.featureArea.create(workspace.id, { name: area.name, description: area.description })
    for (const feature of area.features) {
      const { id: featureId } = await modules.feature.create(workspace.id, { areaId, name: feature.name, description: feature.description })
      for (const { before = [], retired, scope, ...draft } of feature.rules) {
        const [first, ...rest] = [...before, { ...draft, scope }]
        const rule = await modules.rule.create(workspace.id, { ...first!, featureId, scope: scopeOf(first!.scope) })
        for (const version of rest) await modules.rule.supersede(workspace.id, rule.key, { ...version, scope: scopeOf(version.scope) })
        if (retired) await modules.rule.retire(workspace.id, rule.key)
      }
    }
  }
}
