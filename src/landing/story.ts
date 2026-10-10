/**
 * The example everyone shares: Acme Shop, an online store. Every mock tells the
 * same story with the same names and numbers. Sections read it with
 * storyIn(lang). Only what never changes with the language is exported
 * directly: the types, `people` (names) and `dimensions` (the English names,
 * used as keys to find their translation).
 */
import type { ArtifactKind } from '@newt/ui/domain/types'
import type { Lang } from './i18n'

export type { ArtifactKind, BugState, DeltaState, ProposalState } from '@newt/ui/domain/types'

const workspace = { name: 'acme-shop', product: 'Acme Shop' }

export const dimensions = [
  { name: 'surface', values: ['Web', 'Mobile app', 'Backoffice'] },
  { name: 'role', values: ['Guest', 'Customer', 'Admin'] },
  { name: 'market', values: ['Spain', 'Mexico'] },
  { name: 'plan', values: ['Free', 'Premium'] },
] as const

/** Rules of the current definition that the story touches. */
const rules = {
  guestsCannotPay: { id: 'R-12', text: 'Guests cannot pay.', scope: ['role: Guest'] },
  accountOver500: { id: 'R-07', text: 'Payments over €500 require a registered account.', scope: ['role: Guest', 'role: Customer'] },
  invoiceByEmail: { id: 'R-31', text: "A guest's invoice is emailed to the address used at checkout.", scope: ['role: Guest'] },
  freeShipping: { id: 'R-04', text: 'Shipping is free above the free-shipping threshold.', scope: [] },
  paidOrderImmutable: { id: 'R-02', text: 'A paid order cannot change its amount.', scope: [] },
  /** R-12 once PROP-42 is merged (after revision 2 added the limit). */
  guestsPayBizum: { id: 'R-12', text: 'Guests can pay only with Bizum, up to €500, in the mobile app.', scope: ['role: Guest', 'surface: Mobile app'] },
}

/** The proposal at the heart of the story. */
const proposal = {
  id: 'PROP-42',
  title: 'Guests can pay with Bizum in the mobile app',
  author: 'Lucía',
  feature: 'Checkout › Payments',
  ask: 'I want guests to be able to pay with Bizum in the mobile app.',
  document: [
    'Guests abandon checkout in the app when we ask them to sign up.',
    'Bizum is the most used payment method among our mobile customers in Spain.',
    'Guests will be able to pay with Bizum only, up to €500, and get their invoice by email.',
  ],
}

export type Delta = {
  id: string
  op: 'new' | 'changed' | 'retired'
  kind: ArtifactKind
  artifact: string
  before?: string
  after: string
}

const deltas: Delta[] = [
  { id: 'Δ1', op: 'changed', kind: 'rule', artifact: 'R-12', before: 'Guests cannot pay.', after: 'Guests can pay only with Bizum, in the mobile app.' },
  { id: 'Δ2', op: 'new', kind: 'rule', artifact: 'R-31', after: "A guest's invoice is emailed to the address used at checkout." },
  { id: 'Δ3', op: 'changed', kind: 'lifecycle', artifact: 'Order', before: 'created → paid → shipped', after: 'created → awaiting Bizum → paid → shipped' },
  { id: 'Δ4', op: 'new', kind: 'parameter', artifact: 'bizum.guest_limit', after: 'Guest Bizum limit: €500 (Spain)' },
  { id: 'Δ5', op: 'changed', kind: 'actor', artifact: 'Guest', before: 'can browse, can add to cart', after: 'can browse, can add to cart, can pay with Bizum' },
]

/** The conflict newt's gate finds in the first revision. */
const conflict = {
  delta: 'Δ1',
  with: rules.accountOver500,
  explanation: 'Δ1 lets guests pay with Bizum with no limit, but R-07 requires an account for payments over €500. Both apply to guests in the mobile app.',
}

/** The pull request that implements PROP-42. */
const pr = {
  number: 318,
  title: 'feat(checkout): Bizum payments for guests',
  branch: 'feat/guest-bizum',
  author: 'marc',
  file: 'src/checkout/payment.ts',
}

/** A bug reported by monitoring. */
const bug = {
  id: 'BUG-77',
  title: 'Crash when Bizum confirmation times out (iOS)',
  source: 'Monitoring',
  occurrences: 132,
  violates: { kind: 'lifecycle' as ArtifactKind, id: 'Order' },
  scope: ['surface: Mobile app', 'market: Spain'],
  workaround: 'Ask the customer to retry from "My orders"; the order stays in "awaiting Bizum".',
}

/** `date` is in the story's language; `githubDate` is how github.com shows it, always in English. */
const releases = [
  { version: 'v2.3.0', date: 'Sep 18', githubDate: 'Sep 18', changes: 4 },
  { version: 'v2.4.0', date: 'Oct 9', githubDate: 'Oct 9', changes: 6 },
]

export const people = {
  product: 'Lucía',
  dev: 'Marc',
  qa: 'Ana',
  support: 'Jordi',
  sales: 'Paula',
}

// ---------------------------------------------------------------------------
// The same story in both languages. Sections read it through storyIn(lang),
// which returns the values above (English) or their Spanish twin, with the
// same shape: identifiers, names and numbers never change, only the words.
// ---------------------------------------------------------------------------

const storyEn = {
  workspace,
  dimensions: dimensions.map(d => ({ name: d.name as string, values: [...d.values] as string[] })),
  rules,
  proposal,
  deltas,
  conflict,
  pr,
  bug,
  releases,
  people,
}

export type Story = typeof storyEn

const rulesEs: Story['rules'] = {
  guestsCannotPay: { id: 'R-12', text: 'Los invitados no pueden pagar.', scope: ['rol: Invitado'] },
  accountOver500: { id: 'R-07', text: 'Los pagos de más de 500 € requieren una cuenta registrada.', scope: ['rol: Invitado', 'rol: Cliente'] },
  invoiceByEmail: { id: 'R-31', text: 'La factura de un invitado se envía al email que usó en el checkout.', scope: ['rol: Invitado'] },
  freeShipping: { id: 'R-04', text: 'El envío es gratis por encima del umbral de envío gratis.', scope: [] },
  paidOrderImmutable: { id: 'R-02', text: 'Un pedido pagado no puede cambiar de importe.', scope: [] },
  guestsPayBizum: { id: 'R-12', text: 'Los invitados solo pueden pagar con Bizum, hasta 500 €, en la app móvil.', scope: ['rol: Invitado', 'superficie: App móvil'] },
}

const storyEs: Story = {
  workspace,
  dimensions: [
    { name: 'superficie', values: ['Web', 'App móvil', 'Backoffice'] },
    { name: 'rol', values: ['Invitado', 'Cliente', 'Admin'] },
    { name: 'mercado', values: ['España', 'México'] },
    { name: 'plan', values: ['Gratis', 'Premium'] },
  ],
  rules: rulesEs,
  proposal: {
    ...proposal,
    title: 'Los invitados pueden pagar con Bizum en la app móvil',
    feature: 'Checkout › Pagos',
    ask: 'Quiero que los invitados puedan pagar con Bizum en la app móvil.',
    document: [
      'Los invitados abandonan el checkout de la app cuando les pedimos que se registren.',
      'Bizum es el medio de pago más usado por nuestros clientes de la app en España.',
      'Los invitados podrán pagar solo con Bizum, hasta 500 €, y recibirán la factura por email.',
    ],
  },
  deltas: [
    { id: 'Δ1', op: 'changed', kind: 'rule', artifact: 'R-12', before: 'Los invitados no pueden pagar.', after: 'Los invitados solo pueden pagar con Bizum, en la app móvil.' },
    { id: 'Δ2', op: 'new', kind: 'rule', artifact: 'R-31', after: 'La factura de un invitado se envía al email que usó en el checkout.' },
    { id: 'Δ3', op: 'changed', kind: 'lifecycle', artifact: 'Order', before: 'creado → pagado → enviado', after: 'creado → esperando Bizum → pagado → enviado' },
    { id: 'Δ4', op: 'new', kind: 'parameter', artifact: 'bizum.guest_limit', after: 'Límite de Bizum para invitados: 500 € (España)' },
    { id: 'Δ5', op: 'changed', kind: 'actor', artifact: 'Guest', before: 'puede navegar y añadir al carrito', after: 'puede navegar, añadir al carrito y pagar con Bizum' },
  ],
  conflict: {
    delta: 'Δ1',
    with: rulesEs.accountOver500,
    explanation: 'Δ1 deja pagar con Bizum a los invitados sin límite, pero R-07 exige cuenta para pagos de más de 500 €. Las dos aplican a invitados en la app móvil.',
  },
  pr: { ...pr, title: 'feat(checkout): pagos con Bizum para invitados' },
  bug: {
    ...bug,
    title: 'La app se cierra cuando caduca la confirmación de Bizum (iOS)',
    source: 'Monitorización',
    scope: ['superficie: App móvil', 'mercado: España'],
    workaround: 'Pide al cliente que lo reintente desde «Mis pedidos»; el pedido se queda en «esperando Bizum».',
  },
  releases: [
    { version: 'v2.3.0', date: '18 sept', githubDate: 'Sep 18', changes: 4 },
    { version: 'v2.4.0', date: '9 oct', githubDate: 'Oct 9', changes: 6 },
  ],
  people,
}

/** The shared story in a language. */
export function storyIn(lang: Lang): Story {
  return lang === 'es' ? storyEs : storyEn
}
