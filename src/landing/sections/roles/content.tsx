import type { ReactNode } from 'react'
import type { Bi } from '../../i18n'
import { Highlight } from '../../ui/site/section'
import { Emphasis, Mono } from '@newt/ui/components/text'
import type { StageCopy } from '../../ui/scenes/roles/stage'
import type { RolesStoryCopy } from '../../ui/scenes/roles/story'
import type { SupportCopy } from '../../ui/scenes/roles/support'
import type { ProductCopy } from '../../ui/scenes/roles/product'
import type { DevelopmentCopy } from '../../ui/scenes/roles/development'
import type { QaCopy } from '../../ui/scenes/roles/qa'
import type { SalesCopy } from '../../ui/scenes/roles/sales'

/** One role's tab: its name, how the intro calls the seat, what they get, and the steps of their scenario. */
export type Role = { label: string; seat: string; gets: string; steps: string[] }

type RolesContent = {
  eyebrow: string
  title: ReactNode
  lead: string
  tabs: string
  stage: StageCopy
  story: RolesStoryCopy
  support: Role & { scene: SupportCopy }
  product: Role & { scene: ProductCopy }
  development: Role & { scene: DevelopmentCopy }
  qa: Role & { scene: QaCopy }
  sales: Role & { scene: SalesCopy }
}

const chat: Bi = { en: 'Claude · connected to newt', es: 'Claude · conectado a newt' }

export const content: Bi<RolesContent> = {
  en: {
    eyebrow: 'Everyone, one definition',
    title: (
      <>
        The same source of truth, <Highlight>seen from every seat</Highlight>
      </>
    ),
    lead: 'Support, product, development, QA and sales stop keeping their own version of how the product works. Pick a role and watch a day with newt.',
    tabs: 'Roles',
    stage: { steps: 'Scenario steps', step: 'Step' },
    story: { ops: { new: 'new', changed: 'changed', retired: 'retired' }, any: 'any' },

    support: {
      label: 'Support',
      seat: 'support',
      gets: 'Knows in seconds whether a complaint is a known bug, with the workaround product left on it, and turns every repeat into an occurrence instead of a new ticket.',
      steps: [
        'A customer writes in: paying with Bizum crashes the app.',
        'Support asks Claude, in plain words, if it is a known bug.',
        'newt finds BUG-77: confirmed, already seen 132 times.',
        'Claude answers with the workaround product left on the bug.',
        'This customer is one more occurrence, not a new ticket.',
      ],
      scene: {
        chat: chat.en,
        question: 'A customer says the app crashes when paying with Bizum on iOS. Is this a known bug?',
        inbox: 'Support inbox',
        country: 'Spain',
        complaint: '“I tried to pay with Bizum three times and the app closes every time. My order is stuck.”',
        violates: 'violates',
        occurrences: 'occurrences',
        search: '"Bizum crash iOS"',
        known: bug => (
          <>
            Yes: it's <strong>{bug}</strong>, confirmed and still open. Workaround from product:
          </>
        ),
        added: n => `Added as occurrence #${n}. I'll let you know when the fix is merged.`,
      },
    },

    product: {
      label: 'Product',
      seat: 'product',
      gets: 'Changes the product by talking it through, approves exactly what changes delta by delta, and cannot accept anything that contradicts what is already there.',
      steps: [
        'Lucía tells Claude what she wants, in her own words.',
        'Claude checks the current definition and asks what is not clear.',
        'Claude writes PROP-42: the story behind the change.',
        'newt extracts the deltas: what exactly changes in the definition.',
        'The gate finds a conflict with R-07, with an explanation.',
        'One edit later only Δ1 needs a new look. All approved: accepted.',
      ],
      scene: {
        chat: chat.en,
        search: '"guests pay"',
        today: rule => (
          <>
            Today <strong>R-12</strong> says <em>“{rule}”</em> Before I write the proposal:
          </>
        ),
        questions: ['Only Bizum, or every payment method?', 'Only in the mobile app?', 'Where does a guest get the invoice?'],
        document: 'Document',
        by: 'by',
        deltas: 'Deltas extracted from the document',
        conflict: 'Conflict',
        accepted: 'Accepted.',
        acceptedNote: 'Δ2–Δ5 kept their approval; only Δ1 changed. It is now in the development backlog.',
      },
    },

    development: {
      label: 'Development',
      seat: 'development',
      gets: 'Works from accepted proposals instead of guesses, and sees on the pull request itself which rule a line of code breaks.',
      steps: [
        'The backlog is the accepted proposals and the confirmed bugs. Marc picks PROP-42.',
        'His pull request declares what it implements: PROP-42.',
        "newt's check reads the diff against the proposal and the current definition.",
        'A rule is broken, and GitHub shows it on the exact line.',
        'One commit later every artifact passes. Merge.',
        'PROP-42 becomes merged on its own: its deltas are now the current definition.',
      ],
      scene: {
        otherProposal: 'Free shipping threshold per market',
        toDo: 'To do',
        inProgress: 'In progress',
        done: 'Done',
        ready: 'Ready for development',
        line: 'line',
        breaks: 'This lets a guest through at any amount.',
        queued: 'queued',
        reading: 'reading the diff…',
        passing: '5 of 5 artifacts pass',
        failing: '1 failing',
        checks: {
          r12: 'guests can pay only with Bizum',
          r07: 'payments over €500 need an account',
          parameter: 'read from configuration',
          lifecycle: 'new state “awaiting Bizum”',
        },
        document: 'Document',
        delivery: 'Delivery',
        mergedBy: 'merged by',
        updated: 'Current definition updated',
        promoted: 'from planned to current',
        byMerge: 'Nobody touched newt: the merge on GitHub did it.',
      },
    },

    qa: {
      label: 'QA',
      seat: 'QA',
      gets: 'Tests against acceptance criteria that live with the rules, sees what has no test, and catches regressions against the current definition.',
      steps: [
        'Every delta comes with acceptance criteria: given, when, then.',
        'Criteria map to tests. The check flags the one that has none.',
        'A guest says the invoice never arrived. Ana follows the steps and reproduces it.',
        'Confirmed, and linked to the rule it breaks: R-31.',
        'Another PR quietly breaks a rule that worked: the check catches the regression.',
      ],
      scene: {
        criteriaTab: 'Acceptance criteria',
        keywords: { given: 'Given', when: 'when', then: 'then' },
        criteria: [
          { given: 'a guest in the mobile app', when: 'pays €40 with Bizum', then: 'the order is paid', test: 'guest-bizum.spec.ts › pays under limit' },
          { given: 'a guest in the mobile app', when: 'pays €620 with Bizum', then: 'checkout asks to sign up', test: 'guest-bizum.spec.ts › blocks over €500' },
          { given: 'a guest paid with Bizum', when: 'the order is confirmed', then: 'the invoice is emailed to them', test: null },
        ],
        noTest: 'No test covers this criterion.',
        noTestNote: "newt's check will say so on every PR until one does.",
        occurrences: 'Occurrences',
        activity: 'Activity',
        bugTitle: 'Guest invoice email never arrives',
        reproduceLabel: 'Steps to reproduce',
        reproduce: ['Guest checkout in the iOS app', 'Pay €35 with Bizum', 'Wait for the confirmation email'],
        reproduced: 'Reproduced: no email after 10 minutes.',
        breaks: 'Breaks',
        regressionTitle: 'refactor(cart): recompute totals when a coupon changes',
        regression: 'regression',
        regressionNote: 'Line 19 changes the amount of orders that are already paid. No proposal changes this rule.',
        noTransitions: 'no new transitions',
        caught: 'Caught before merge, against the current definition, not against what someone remembered.',
      },
    },

    sales: {
      label: 'Sales',
      seat: 'sales',
      gets: 'Answers what the product does today, and what is already planned, for this market and this plan, without promising what the definition does not say.',
      steps: [
        'A prospect in Mexico asks if their customers can pay without an account.',
        'Paula asks Claude, filtering the definition by market and plan.',
        'newt shows what is true today and what is already planned, for Mexico.',
        'Claude answers from the definition: nothing promised that is not there.',
        'The request becomes a draft proposal for product to weigh.',
      ],
      scene: {
        chat: chat.en,
        subject: 'Re: Acme Shop for our stores in Mexico',
        plan: 'Premium plan',
        email: (
          <>
            “Looks great. One thing: <Emphasis>can our customers in Mexico pay without creating an account?</Emphasis> It's a deal breaker for us.”
          </>
        ),
        question: 'Can guests pay without an account in Mexico, on the Premium plan? Today, and in the next release?',
        definition: 'Definition',
        current: 'Current',
        planned: 'Planned',
        currentLabel: 'Current · in production',
        plannedLabel: 'Planned · accepted, not shipped',
        notHere: 'Does not apply to Mexico',
        only: (name, value) => `${name}: ${value} only`,
        filtered: 'Filtered by dimension: only what applies to a guest in Mexico on Premium.',
        today: (
          <>
            <strong>Today: no.</strong> In Mexico guests can't pay (<Mono>R-12</Mono>).
          </>
        ),
        next: (
          <>
            <strong>Next release:</strong> guests will pay with Bizum, but only in Spain (<Mono>PROP-42</Mono>). Nothing is planned for Mexico, so I wouldn't
            promise it.
          </>
        ),
        offer: 'Want me to raise it with product as a draft proposal?',
        yes: 'Yes, please.',
        requestTitle: 'Guest checkout in Mexico',
        requestedBy: 'requested by',
        waiting: 'waiting for product',
      },
    },
  },

  es: {
    eyebrow: 'Todo el mundo, una definición',
    title: (
      <>
        La misma fuente de verdad, <Highlight>vista desde cada puesto</Highlight>
      </>
    ),
    lead: 'Soporte, producto, desarrollo, QA y ventas dejan de tener cada uno su versión de cómo funciona el producto. Elige un rol y mira un día con newt.',
    tabs: 'Roles',
    stage: { steps: 'Pasos del escenario', step: 'Paso' },
    story: { ops: { new: 'nuevo', changed: 'cambiado', retired: 'retirado' }, any: 'cualquiera' },

    support: {
      label: 'Soporte',
      seat: 'soporte',
      gets: 'Sabe en segundos si una queja es un bug conocido, con el workaround que dejó producto, y convierte cada repetición en una ocurrencia en vez de un ticket nuevo.',
      steps: [
        'Escribe una clienta: al pagar con Bizum se cierra la app.',
        'Soporte le pregunta a Claude, con sus palabras, si es un bug conocido.',
        'newt encuentra BUG-77: confirmed y visto ya 132 veces.',
        'Claude responde con el workaround que dejó producto en el bug.',
        'Esta clienta es una ocurrencia más, no un ticket nuevo.',
      ],
      scene: {
        chat: chat.es,
        question: 'Una clienta dice que la app se cierra al pagar con Bizum en iOS. ¿Es un bug conocido?',
        inbox: 'Bandeja de soporte',
        country: 'España',
        complaint: '«He intentado pagar con Bizum tres veces y la app se cierra cada vez. Mi pedido se ha quedado colgado.»',
        violates: 'incumple',
        occurrences: 'ocurrencias',
        search: '"Bizum se cierra iOS"',
        known: bug => (
          <>
            Sí: es <strong>{bug}</strong>, confirmado y todavía abierto. El workaround de producto:
          </>
        ),
        added: n => `Añadida como ocurrencia n.º ${n}. Te aviso cuando se mergee el arreglo.`,
      },
    },

    product: {
      label: 'Producto',
      seat: 'producto',
      gets: 'Cambia el producto conversando, aprueba exactamente lo que cambia, delta a delta, y no puede aceptar nada que contradiga lo que ya existe.',
      steps: [
        'Lucía le cuenta a Claude lo que quiere, con sus palabras.',
        'Claude revisa la definición vigente y pregunta lo que no está claro.',
        'Claude escribe PROP-42: el relato detrás del cambio.',
        'newt extrae los deltas: qué cambia exactamente en la definición.',
        'La puerta encuentra un conflicto con R-07, y lo explica.',
        'Tras un cambio, solo Δ1 necesita otra mirada. Todo approved: accepted.',
      ],
      scene: {
        chat: chat.es,
        search: '"invitados pagar"',
        today: rule => (
          <>
            Hoy <strong>R-12</strong> dice <em>«{rule}»</em> Antes de escribir la proposal:
          </>
        ),
        questions: ['¿Solo Bizum o todos los medios de pago?', '¿Solo en la app móvil?', '¿Dónde recibe la factura un invitado?'],
        document: 'Documento',
        by: 'de',
        deltas: 'Deltas extraídos del documento',
        conflict: 'Conflicto',
        accepted: 'Aceptada.',
        acceptedNote: 'Δ2–Δ5 conservan su aprobación; solo cambió Δ1. Ya está en el backlog de desarrollo.',
      },
    },

    development: {
      label: 'Desarrollo',
      seat: 'desarrollo',
      gets: 'Trabaja a partir de proposals aceptadas en vez de suposiciones, y ve en la propia pull request qué rule rompe una línea de código.',
      steps: [
        'El backlog son las proposals accepted y los bugs confirmed. Marc coge PROP-42.',
        'Su pull request declara qué implementa: PROP-42.',
        'El check de newt lee el diff contra la proposal y la definición vigente.',
        'Se rompe una rule, y GitHub lo señala en la línea exacta.',
        'Un commit después, todos los artifacts pasan. Merge.',
        'PROP-42 pasa sola a merged: sus deltas ya son la definición vigente.',
      ],
      scene: {
        otherProposal: 'Umbral de envío gratis por mercado',
        toDo: 'Por hacer',
        inProgress: 'En curso',
        done: 'Hecho',
        ready: 'Listo para desarrollo',
        line: 'línea',
        breaks: 'Esto deja pasar a un invitado con cualquier importe.',
        queued: 'en cola',
        reading: 'leyendo el diff…',
        passing: '5 de 5 artifacts pasan',
        failing: '1 falla',
        checks: {
          r12: 'los invitados solo pagan con Bizum',
          r07: 'los pagos de más de 500 € requieren cuenta',
          parameter: 'se lee de la configuración',
          lifecycle: 'nuevo estado «esperando Bizum»',
        },
        document: 'Documento',
        delivery: 'Entrega',
        mergedBy: 'mergeada por',
        updated: 'Definición vigente actualizada',
        promoted: 'de la prevista a la vigente',
        byMerge: 'Nadie tocó newt: lo hizo el merge en GitHub.',
      },
    },

    qa: {
      label: 'QA',
      seat: 'QA',
      gets: 'Prueba contra criterios de aceptación que viven junto a las rules, ve lo que no tiene test y detecta regresiones contra la definición vigente.',
      steps: [
        'Cada delta trae sus criterios de aceptación: dado, cuando, entonces.',
        'Los criterios se enlazan con tests. El check señala el que no tiene ninguno.',
        'Un invitado dice que nunca le llegó la factura. Ana sigue los pasos y lo reproduce.',
        'Confirmed, y enlazado a la rule que incumple: R-31.',
        'Otra PR rompe sin hacer ruido una rule que funcionaba: el check detecta la regresión.',
      ],
      scene: {
        criteriaTab: 'Criterios de aceptación',
        keywords: { given: 'Dado', when: 'cuando', then: 'entonces' },
        criteria: [
          { given: 'un invitado en la app móvil', when: 'paga 40 € con Bizum', then: 'el pedido queda pagado', test: 'guest-bizum.spec.ts › pays under limit' },
          { given: 'un invitado en la app móvil', when: 'paga 620 € con Bizum', then: 'el checkout le pide registrarse', test: 'guest-bizum.spec.ts › blocks over €500' },
          { given: 'un invitado ha pagado con Bizum', when: 'se confirma el pedido', then: 'le llega la factura por email', test: null },
        ],
        noTest: 'Ningún test cubre este criterio.',
        noTestNote: 'El check de newt lo dirá en cada PR hasta que lo haya.',
        occurrences: 'Ocurrencias',
        activity: 'Actividad',
        bugTitle: 'Al invitado nunca le llega el email con la factura',
        reproduceLabel: 'Pasos para reproducirlo',
        reproduce: ['Checkout como invitado en la app de iOS', 'Pagar 35 € con Bizum', 'Esperar el email de confirmación'],
        reproduced: 'Reproducido: ni rastro del email tras 10 minutos.',
        breaks: 'Incumple',
        regressionTitle: 'refactor(cart): recalcular los totales al cambiar un cupón',
        regression: 'regresión',
        regressionNote: 'La línea 19 cambia el importe de pedidos que ya están pagados. Ninguna proposal cambia esta rule.',
        noTransitions: 'sin transiciones nuevas',
        caught: 'Detectado antes del merge, contra la definición vigente, no contra lo que alguien recordaba.',
      },
    },

    sales: {
      label: 'Ventas',
      seat: 'ventas',
      gets: 'Responde qué hace hoy el producto y qué está ya previsto, para este mercado y este plan, sin prometer lo que la definición no dice.',
      steps: [
        'Un posible cliente de México pregunta si sus clientes pueden pagar sin cuenta.',
        'Paula le pregunta a Claude, filtrando la definición por mercado y plan.',
        'newt enseña lo que es cierto hoy y lo que ya está previsto, para México.',
        'Claude responde desde la definición: no promete nada que no esté ahí.',
        'La petición se convierte en una proposal en draft para que producto la valore.',
      ],
      scene: {
        chat: chat.es,
        subject: 'Re: Acme Shop para nuestras tiendas en México',
        plan: 'Plan Premium',
        email: (
          <>
            «Tiene muy buena pinta. Una cosa: <Emphasis>¿nuestros clientes en México pueden pagar sin crearse una cuenta?</Emphasis> Para nosotros es
            imprescindible.»
          </>
        ),
        question: '¿Los invitados pueden pagar sin cuenta en México, con el plan Premium? ¿Hoy y en la próxima release?',
        definition: 'Definición',
        current: 'Vigente',
        planned: 'Prevista',
        currentLabel: 'Vigente · en producción',
        plannedLabel: 'Prevista · accepted, sin publicar',
        notHere: 'No aplica a México',
        only: (name, value) => `solo ${name}: ${value}`,
        filtered: 'Filtrado por dimension: solo lo que aplica a un invitado en México con Premium.',
        today: (
          <>
            <strong>Hoy: no.</strong> En México los invitados no pueden pagar (<Mono>R-12</Mono>).
          </>
        ),
        next: (
          <>
            <strong>Próxima release:</strong> los invitados pagarán con Bizum, pero solo en España (<Mono>PROP-42</Mono>). No hay nada previsto para México, así
            que yo no lo prometería.
          </>
        ),
        offer: '¿Quieres que se lo plantee a producto como una proposal en draft?',
        yes: 'Sí, por favor.',
        requestTitle: 'Checkout de invitados en México',
        requestedBy: 'pedida por',
        waiting: 'pendiente de producto',
      },
    },
  },
}
