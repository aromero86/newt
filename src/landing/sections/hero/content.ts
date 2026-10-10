import type { Bi } from '../../i18n'
import type { HeroLoopCopy } from '../../ui/scenes/hero/loop'

/** Every text of the hero, in both languages. */
export const content: Bi<{
  badge: string
  title: string
  highlight: string
  lead: string
  leadStrong: string
  star: string
  quickstart: string
  perks: string[]
  loop: HeroLoopCopy
}> = {
  en: {
    badge: 'Early preview · open source · in development',
    title: "Your product's definition, ",
    highlight: 'versioned like code.',
    lead: 'newt keeps every rule, entity and permission of your product in one living definition. Changes are proposed talking to Claude, approved delta by delta, refused if they contradict anything, and ',
    leadStrong: 'checked on every pull request',
    star: 'Star on GitHub',
    quickstart: 'Read the quickstart',
    perks: ['Self-hosted', 'Claude-native (MCP)', 'GitHub App', 'Bootstraps from your code'],
    loop: {
      label:
        'Animated overview: a request becomes a proposal, passes the gate, is implemented in a pull request and ships in a release.',
      stages: ['Talk', 'Propose', 'Gate', 'Pull request', 'Release'],
      talk: {
        caption: 'Product talks to Claude',
        today: 'Today ',
        says: ' says ',
        question: 'Only Bizum, or every payment method? And up to what amount?',
      },
      propose: { caption: 'A proposal, with its deltas' },
      gate: {
        caption: 'The gate checks the whole definition',
        conflict: 'Conflict',
        explanation: rule => `Guests could pay over €500 with Bizum, but ${rule} requires an account above that amount.`,
      },
      pr: {
        caption: n => `On GitHub: newt checks PR #${n}`,
        enforced: 'Guests pay only with Bizum — enforced',
        tested: 'Guest invoice by email — tested',
        limitSkipped: '€500 limit skipped for Bizum',
        noTest: '“awaiting Bizum” has no test',
      },
      release: {
        caption: 'Product and code ship together',
        subtitle: 'GitHub release = product release',
        shipped: ['Guests can pay with Bizum in the app (≤ €500)', 'Guest invoices are emailed', 'Order: new “awaiting Bizum” state'],
      },
    },
  },
  es: {
    badge: 'Avance · open source · en desarrollo',
    title: 'La definición de tu producto, ',
    highlight: 'versionada como el código.',
    lead: 'newt guarda cada rule, entity y permiso de tu producto en una única definición viva. Los cambios se proponen hablando con Claude, se aprueban delta a delta, se rechazan si contradicen algo y ',
    leadStrong: 'se comprueban en cada pull request',
    star: 'Ver en GitHub',
    quickstart: 'Cómo empezar',
    perks: ['En tus servidores', 'Hecho para Claude (MCP)', 'App de GitHub', 'Arranca desde tu código'],
    loop: {
      label:
        'Resumen animado: una petición se convierte en una proposal, pasa la puerta, se implementa en una pull request y sale en una release.',
      stages: ['Hablar', 'Proponer', 'Puerta', 'Pull request', 'Release'],
      talk: {
        caption: 'Producto habla con Claude',
        today: 'Hoy ',
        says: ' dice ',
        question: '¿Solo Bizum o cualquier medio de pago? ¿Y hasta qué importe?',
      },
      propose: { caption: 'Una proposal, con sus deltas' },
      gate: {
        caption: 'La puerta revisa toda la definición',
        conflict: 'Conflicto',
        explanation: rule => `Los invitados podrían pagar más de 500 € con Bizum, pero ${rule} exige cuenta por encima de ese importe.`,
      },
      pr: {
        caption: n => `En GitHub: newt revisa la PR #${n}`,
        enforced: 'Los invitados pagan solo con Bizum — se cumple',
        tested: 'Factura del invitado por email — con test',
        limitSkipped: 'El límite de 500 € no se aplica a Bizum',
        noTest: '«esperando Bizum» no tiene test',
      },
      release: {
        caption: 'Producto y código salen juntos',
        subtitle: 'Release de GitHub = release de producto',
        shipped: [
          'Los invitados pueden pagar con Bizum en la app (≤ 500 €)',
          'Las facturas de invitados se envían por email',
          'Order: nuevo estado «esperando Bizum»',
        ],
      },
    },
  },
}
