import type { Bi } from '../../i18n'
import type { BoardCopy } from '../../ui/scenes/screens/board-screen'
import type { BugCopy } from '../../ui/scenes/screens/bug-screen'
import type { DefinitionCopy } from '../../ui/scenes/screens/definition-screen'
import type { ProposalCopy } from '../../ui/scenes/screens/proposal-screen'

type Tile = { title: string; text: string }

export const content: Bi<{
  eyebrow: string
  title: string
  intro: string
  tiles: { proposal: Tile; definition: Tile; board: Tile; bug: Tile }
  proposal: ProposalCopy
  definition: DefinitionCopy
  board: BoardCopy
  bug: BugCopy
}> = {
  en: {
    eyebrow: 'The app',
    title: 'Everything a product team reviews, in one place.',
    intro: 'A review tool that feels like GitHub, built for product definitions instead of files. Design previews of what we are building.',
    tiles: {
      proposal: {
        title: 'A proposal',
        text: 'The document, its deltas with “viewed” checkboxes, the gate\'s findings and every revision.',
      },
      definition: {
        title: 'Current vs planned',
        text: 'How the product works today, and how it will once accepted proposals ship.',
      },
      board: {
        title: 'The board',
        text: 'Proposals and bugs in one view, filtered by any dimension of your product.',
      },
      bug: {
        title: 'Bugs, grouped',
        text: 'Crashes from monitoring land as one bug with its occurrences, linked to what it breaks.',
      },
    },
    proposal: {
      document: 'Document',
      checks: 'Checks',
      state: 'State',
      conflict: 'No limit for guests, but R-07 asks for an account over €500.',
      noConflicts: 'No conflicts',
      revision1: 'Lucía · first draft',
      revision2: 'Lucía · limit to €500',
      accept: 'Accept proposal',
      viewed: delta => `Viewed ${delta}`,
    },
    definition: {
      definition: 'Definition',
      current: 'Current',
      planned: 'Planned',
      notYet: 'not yet',
      freeShipping: { current: '€50 (Spain)', planned: '€40 (Spain)' },
      currentNote: 'What is merged and running in production today.',
      plannedNote: 'Includes PROP-42 and PROP-45, accepted and waiting for their code.',
    },
    board: {
      surface: 'surface',
      mobileApp: 'Mobile app',
      market: 'market',
      any: 'Any',
      type: 'type',
      proposalsAndBugs: 'Proposals & bugs',
      items: count => `${count} items`,
      columns: ['Product', 'To do', 'In progress', 'Done'],
      titles: {
        'PROP-51': 'Loyalty points',
        'BUG-80': 'Coupon field hidden on Android',
        'PROP-42': 'Guests pay with Bizum',
        'PROP-45': 'Shipping rules for Mexico',
        'BUG-77': 'Crash on Bizum timeout (iOS)',
        'PROP-39': 'Refund approvals',
        'PROP-40': 'Order history for guests',
        'PROP-36': 'Saved addresses',
      },
    },
    bug: {
      monitoring: 'From monitoring · last 14 days',
      occurrences: count => `${count} occurrences`,
      groupedInto: 'grouped into',
      breaks: 'Breaks',
      neverReaches: '“awaiting Bizum” never reaches “paid”',
      workaround: 'Workaround for support:',
    },
  },
  es: {
    eyebrow: 'La app',
    title: 'Todo lo que revisa un equipo de producto, en un solo sitio.',
    intro:
      'Una herramienta de revisión que se siente como GitHub, pensada para definiciones de producto en vez de ficheros. Son avances de diseño de lo que estamos construyendo.',
    tiles: {
      proposal: {
        title: 'Una proposal',
        text: 'El documento, sus deltas con casillas de “visto”, lo que encuentra la puerta y cada revision.',
      },
      definition: {
        title: 'Vigente y prevista',
        text: 'Cómo funciona el producto hoy, y cómo funcionará cuando salgan las proposals aceptadas.',
      },
      board: {
        title: 'El board',
        text: 'Proposals y bugs en una sola vista, filtrados por cualquier dimension de tu producto.',
      },
      bug: {
        title: 'Bugs agrupados',
        text: 'Los crashes de la monitorización llegan como un único bug con sus ocurrencias, enlazado a lo que rompe.',
      },
    },
    proposal: {
      document: 'Documento',
      checks: 'Comprobaciones',
      state: 'Estado',
      conflict: 'Sin límite para invitados, pero R-07 pide cuenta por encima de 500 €.',
      noConflicts: 'Sin conflictos',
      revision1: 'Lucía · primer borrador',
      revision2: 'Lucía · límite de 500 €',
      accept: 'Aceptar proposal',
      viewed: delta => `${delta} visto`,
    },
    definition: {
      definition: 'Definición',
      current: 'Vigente',
      planned: 'Prevista',
      notYet: 'todavía no',
      freeShipping: { current: '50 € (España)', planned: '40 € (España)' },
      currentNote: 'Lo que está merged y funcionando hoy en producción.',
      plannedNote: 'Incluye PROP-42 y PROP-45, aceptadas y a la espera de su código.',
    },
    board: {
      surface: 'superficie',
      mobileApp: 'App móvil',
      market: 'mercado',
      any: 'Cualquiera',
      type: 'tipo',
      proposalsAndBugs: 'Proposals y bugs',
      items: count => `${count} elementos`,
      columns: ['Producto', 'Por hacer', 'En curso', 'Hecho'],
      titles: {
        'PROP-51': 'Puntos de fidelidad',
        'BUG-80': 'Campo de cupón oculto en Android',
        'PROP-42': 'Invitados pagan con Bizum',
        'PROP-45': 'Reglas de envío para México',
        'BUG-77': 'Cierre al caducar Bizum (iOS)',
        'PROP-39': 'Aprobación de reembolsos',
        'PROP-40': 'Historial de pedidos para invitados',
        'PROP-36': 'Direcciones guardadas',
      },
    },
    bug: {
      monitoring: 'De la monitorización · últimos 14 días',
      occurrences: count => `${count} ocurrencias`,
      groupedInto: 'agrupado en',
      breaks: 'Rompe',
      neverReaches: '«esperando Bizum» nunca llega a «pagado»',
      workaround: 'Solución temporal para soporte:',
    },
  },
}
