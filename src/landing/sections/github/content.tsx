import type { ReactNode } from 'react'
import type { Bi } from '../../i18n'
import { storyIn } from '../../story'
import { Highlight } from '../../ui/site/section'
import type { BlockedCopy } from '../../ui/scenes/github/blocked'
import type { LinkedCopy } from '../../ui/scenes/github/linked'
import type { NoProposalCopy } from '../../ui/scenes/github/no-proposal'
import type { ReleasedCopy } from '../../ui/scenes/github/released'
import type { UrgentCopy } from '../../ui/scenes/github/urgent'
import { Mono, Strong, Tone } from '@newt/ui/components/text'

// What people and newt write is translated; GitHub's own interface stays in
// English and lives with the scenes. The story's names and ids are read from
// the story itself, so the texts and the mocks never disagree.

type Content = {
  eyebrow: string
  title: ReactNode
  lead: string
  tablist: string
  tabs: { linked: string; blocked: string; noProposal: string; urgent: string; released: string }
  linked: LinkedCopy
  blocked: BlockedCopy
  noProposal: NoProposalCopy
  urgent: UrgentCopy
  released: ReleasedCopy
  cards: { title: string; text: string }[]
}

const en = storyIn('en')
const es = storyIn('es')

const hotfixReason: Bi = {
  en: 'Crash in production: 132 occurrences in the last hour (BUG-77).',
  es: 'Fallo grave en producción: 132 ocurrencias en la última hora (BUG-77).',
}

export const content: Bi<Content> = {
  en: {
    eyebrow: 'GitHub integration',
    title: (
      <>
        A dev never has to leave GitHub <Highlight>to know what doesn’t comply.</Highlight>
      </>
    ),
    lead: 'newt is a required check on every pull request. It knows which proposal the PR implements, checks the code against it and against the current definition, and points at the exact line that breaks a rule.',
    tablist: 'GitHub scenarios',
    tabs: {
      linked: 'Linked & checked',
      blocked: 'Not accepted, not checked',
      noProposal: 'PRs with no proposal',
      urgent: 'The urgent lane',
      released: 'Merged & released',
    },
    linked: {
      captions: [
        'The PR says what it implements — "Implements PROP-42", like Closes #123.',
        'newt is a required check. It runs because PROP-42 is accepted.',
        'One line per artifact: what complies, what breaks, what has no test.',
        'The failure lands on the exact line of the diff, with the rule it breaks.',
        `${en.people.dev} pushes a fix. Every artifact complies: the PR can be merged.`,
      ],
      body: 'Bizum payments for guests in the mobile app.',
      fixCommit: 'fix: cap guest Bizum at bizum.guest_limit',
      checking: 'Checking against PROP-42 (accepted) and the current definition…',
      passDetail: 'Every artifact touched by this PR complies.',
      failDetail: '1 artifact broken · 1 without a test · 3 comply',
      guestCanPay: 'can pay with Bizum',
      anyAmount: ' — a guest can pay any amount',
      invoiceEmailed: 'Invoice emailed to guests',
      noTest: 'no test covers it',
      viewInNewt: `View ${en.proposal.id} in newt →`,
      blockedReason: (
        <>
          Required check <b>newt / definition</b> failed: rule {en.rules.accountOver500.id}.
        </>
      ),
      annotation: (
        <>
            A guest can pay <Strong>any amount</Strong> with Bizum here. {en.rules.accountOver500.id} requires a registered account over €500 —{' '}
            <Mono>bizum.guest_limit</Mono> = €500 (Δ4 of {en.proposal.id}).
        </>
      ),
    },
    blocked: {
      captions: [
        'This PR implements PROP-45, which product is still discussing.',
        'newt won’t check code against something that can still change: the check doesn’t run.',
        'So the PR can’t be merged — and it says why, with a link to the proposal.',
        `${en.people.product} accepts PROP-45 in newt. The check runs on its own.`,
      ],
      prTitle: 'feat(checkout): returning guests can save a card',
      proposalTitle: 'Returning guests can save a card',
      body: "Remember a guest's card for their next order.",
      acceptedChecking: 'PROP-45 was accepted — checking now…',
      notRun: (
        <>
          Not run: <Strong>PROP-45</Strong> is <Tone tone="warn">in review</Tone>, not accepted.
        </>
      ),
      waiting: 'Waiting for newt / definition to finish.',
      blockedReason: (
        <>
          Required check <b>newt / definition</b>: the proposal this PR implements isn’t accepted yet.
        </>
      ),
      acceptedBy: (
        <>
          Accepted by <Strong>{en.people.product}</Strong> · 4 deltas approved · gate passed
        </>
      ),
    },
    noProposal: {
      captions: [
        'A PR with no proposal. Its author calls it a fix.',
        `newt reads the change: it’s a behavior change — ${en.rules.paidOrderImmutable.id} would no longer hold.`,
        'newt drafts the proposal from the PR — PROP-47, origin: code — and the PR waits for product.',
        'A technical PR changes no behavior, so it goes straight through.',
      ],
      behaviorTitle: "fix(backoffice): support can edit a paid order's amount",
      draftedTitle: 'Support can correct the amount of a paid order',
      behaviorBody: "Support needs to correct an order's amount after a payment error.",
      type: 'Type',
      noLinked: 'No linked proposal',
      declaredDetail: (
        <>
          Declared as <i>fix</i>, but this <Strong>changes behavior</Strong> with no proposal.
        </>
      ),
      noLongerTrue: '— no longer true in the backoffice',
      draftedForYou: 'This needs a product decision, so I drafted it for you:',
      originCode: 'origin: code',
      typeCorrection: 'type: correction',
      deltaChanged: `1 delta · ${en.rules.paidOrderImmutable.id} changed`,
      waitingFor: (
        <>
          Waiting for <b>PROP-47</b> to be accepted by product.
        </>
      ),
      technicalTitle: 'refactor(payments): extract the gateway client',
      technicalBody: 'Moves the payment gateway client to its own module. No functional changes.',
      typeTechnical: 'Type: technical',
      technicalDetail: 'Technical: no behavior change against the current definition.',
      stillComply: (
        <>
          37 artifacts in <Mono>Checkout › Payments</Mono> still comply
        </>
      ),
    },
    urgent: {
      captions: [
        `Production is crashing. The hotfix resolves ${en.bug.id} — but it changes the Order lifecycle.`,
        `It can’t wait for product at 3 a.m. ${en.people.dev} takes the urgent lane, with a reason.`,
        'It merges — and newt records who did it and why.',
        `Product sees it next morning: PROP-48 waits to be validated, ${en.bug.id} is resolved.`,
      ],
      prTitle: 'hotfix(checkout): cancel orders stuck awaiting Bizum',
      reason: hotfixReason.en,
      draftedTitle: 'Orders awaiting Bizum are cancelled after 15 minutes',
      resolves: 'Resolves',
      occurrences: 'occurrences',
      needsDecision: 'Needs a product decision: adds awaiting Bizum → cancelled after 15 min.',
      newTransition: 'New transition with no accepted proposal',
      blockedReason: 'A behavior change needs an accepted proposal.',
      reasonLabel: 'Reason',
      urgent: { title: 'Urgent lane: merge without an accepted proposal', button: 'Merge without acceptance' },
      mergedBy: (
        <>
          Merged by <Strong>{en.people.dev}</Strong> without acceptance · “{hotfixReason.en}”
        </>
      ),
      sideTitle: 'Merged without acceptance · 1',
      mergedWithoutAcceptance: 'merged without acceptance',
      originBy: `origin: code · by ${en.people.dev}`,
      validate: 'Validate or correct →',
    },
    released: {
      captions: [
        `Every check passes. ${en.people.dev} merges #${en.pr.number}.`,
        `${en.proposal.id} moves to merged on its own: its deltas are now the current definition.`,
        `${en.people.dev} publishes v2.4.0 on GitHub…`,
        '…and it is a release of the product too, with a changelog anyone can read.',
      ],
      mergedNote: (
        <>
          {en.proposal.id} is now <Strong>merged</Strong> in newt.
        </>
      ),
      currentDefinition: 'Current definition',
      ops: { new: 'new', changed: 'changed', retired: 'retired' },
      changelog: { changed: 'Changed', new: 'New' },
      more: `+ ${en.deltas.length - 3} more · from ${en.proposal.id}`,
      sameVersion: 'Same version as the code →',
    },
    cards: [
      { title: 'Linked like issues', text: '“Implements PROP-42” in a PR works like “Closes #123”: merge it and the proposal is merged in newt.' },
      { title: 'Annotated like a linter', text: 'Each artifact gets a line in the report, and failures land on the diff line that causes them.' },
      { title: 'Released together', text: 'A GitHub release is a product release, so the changelog and the code always speak about the same version.' },
    ],
  },
  es: {
    eyebrow: 'Integración con GitHub',
    title: (
      <>
        Un dev nunca tiene que salir de GitHub <Highlight>para saber qué no cumple.</Highlight>
      </>
    ),
    lead: 'newt es un check obligatorio en cada pull request. Sabe qué proposal implementa la PR, comprueba el código contra ella y contra la definición vigente, y señala la línea exacta que rompe una rule.',
    tablist: 'Escenarios en GitHub',
    tabs: {
      linked: 'Enlazada y comprobada',
      blocked: 'Sin aceptar, sin comprobar',
      noProposal: 'PRs sin proposal',
      urgent: 'El carril urgente',
      released: 'Mergeada y publicada',
    },
    linked: {
      captions: [
        'La PR dice qué implementa: "Implements PROP-42", como un Closes #123.',
        'newt es un check obligatorio. Se ejecuta porque PROP-42 está aceptada.',
        'Una línea por artifact: qué cumple, qué rompe y qué no tiene test.',
        'El fallo aparece en la línea exacta del diff, con la rule que rompe.',
        `${es.people.dev} sube un arreglo. Todos los artifacts cumplen: la PR se puede mergear.`,
      ],
      body: 'Pagos con Bizum para invitados en la app móvil.',
      fixCommit: 'fix: limitar el Bizum de invitados a bizum.guest_limit',
      checking: 'Comprobando contra PROP-42 (aceptada) y la definición vigente…',
      passDetail: 'Todos los artifacts que toca esta PR cumplen.',
      failDetail: '1 artifact roto · 1 sin test · 3 cumplen',
      guestCanPay: 'puede pagar con Bizum',
      anyAmount: ' — un invitado puede pagar cualquier importe',
      invoiceEmailed: 'Factura por email a los invitados',
      noTest: 'ningún test lo cubre',
      viewInNewt: `Ver ${es.proposal.id} en newt →`,
      blockedReason: (
        <>
          El check obligatorio <b>newt / definition</b> ha fallado: rule {es.rules.accountOver500.id}.
        </>
      ),
      annotation: (
        <>
            Aquí un invitado puede pagar <Strong>cualquier importe</Strong> con Bizum. {es.rules.accountOver500.id} exige una cuenta registrada por encima de 500 € —{' '}
            <Mono>bizum.guest_limit</Mono> = 500 € (Δ4 de {es.proposal.id}).
        </>
      ),
    },
    blocked: {
      captions: [
        'Esta PR implementa PROP-45, que producto todavía está discutiendo.',
        'newt no comprueba el código contra algo que aún puede cambiar: el check no se ejecuta.',
        'Así que la PR no se puede mergear, y lo dice: por qué y con enlace a la proposal.',
        `${es.people.product} acepta PROP-45 en newt. El check se ejecuta solo.`,
      ],
      prTitle: 'feat(checkout): los invitados que repiten pueden guardar una tarjeta',
      proposalTitle: 'Los invitados que repiten pueden guardar una tarjeta',
      body: 'Recordar la tarjeta de un invitado para su próximo pedido.',
      acceptedChecking: 'PROP-45 se ha aceptado: comprobando…',
      notRun: (
        <>
          No se ejecuta: <Strong>PROP-45</Strong> está <Tone tone="warn">in review</Tone>, sin aceptar.
        </>
      ),
      waiting: 'Esperando a que termine newt / definition.',
      blockedReason: (
        <>
          Check obligatorio <b>newt / definition</b>: la proposal que implementa esta PR aún no está aceptada.
        </>
      ),
      acceptedBy: (
        <>
          Aceptada por <Strong>{es.people.product}</Strong> · 4 deltas aprobados · puerta superada
        </>
      ),
    },
    noProposal: {
      captions: [
        'Una PR sin proposal. Su autor dice que es un arreglo.',
        `newt lee el cambio: cambia el comportamiento, y ${es.rules.paidOrderImmutable.id} dejaría de cumplirse.`,
        'newt redacta la proposal a partir de la PR (PROP-47, origen: código) y la PR espera a producto.',
        'Una PR técnica no cambia ningún comportamiento, así que pasa directa.',
      ],
      behaviorTitle: 'fix(backoffice): soporte puede editar el importe de un pedido pagado',
      draftedTitle: 'Soporte puede corregir el importe de un pedido pagado',
      behaviorBody: 'Soporte necesita corregir el importe de un pedido tras un error en el pago.',
      type: 'Tipo',
      noLinked: 'Sin proposal enlazada',
      declaredDetail: (
        <>
          Declarada como <i>fix</i>, pero <Strong>cambia el comportamiento</Strong> sin proposal.
        </>
      ),
      noLongerTrue: '— deja de cumplirse en el backoffice',
      draftedForYou: 'Esto necesita una decisión de producto, así que te la he redactado:',
      originCode: 'origen: código',
      typeCorrection: 'tipo: corrección',
      deltaChanged: `1 delta · ${es.rules.paidOrderImmutable.id} cambiada`,
      waitingFor: (
        <>
          Esperando a que producto acepte <b>PROP-47</b>.
        </>
      ),
      technicalTitle: 'refactor(payments): extraer el cliente de la pasarela',
      technicalBody: 'Lleva el cliente de la pasarela de pago a su propio módulo. Sin cambios funcionales.',
      typeTechnical: 'Tipo: técnica',
      technicalDetail: 'Técnica: ningún cambio de comportamiento respecto a la definición vigente.',
      stillComply: (
        <>
          Los 37 artifacts de <Mono>Checkout › Payments</Mono> siguen cumpliendo
        </>
      ),
    },
    urgent: {
      captions: [
        `Producción se está cayendo. El hotfix resuelve ${es.bug.id}, pero cambia el lifecycle de Order.`,
        `A las 3 de la madrugada no se puede esperar a producto. ${es.people.dev} toma el carril urgente, con un motivo.`,
        'Se mergea, y newt registra quién lo hizo y por qué.',
        `Producto lo ve a la mañana siguiente: PROP-48 espera a validarse y ${es.bug.id} está resuelto.`,
      ],
      prTitle: 'hotfix(checkout): cancelar los pedidos atascados esperando a Bizum',
      reason: hotfixReason.es,
      draftedTitle: 'Los pedidos que esperan a Bizum se cancelan a los 15 minutos',
      resolves: 'Resuelve',
      occurrences: 'ocurrencias',
      needsDecision: 'Necesita una decisión de producto: añade awaiting Bizum → cancelled a los 15 min.',
      newTransition: 'Transición nueva sin proposal aceptada',
      blockedReason: 'Un cambio de comportamiento necesita una proposal aceptada.',
      reasonLabel: 'Motivo',
      urgent: { title: 'Carril urgente: mergear sin una proposal aceptada', button: 'Mergear sin aceptar' },
      mergedBy: (
        <>
          Mergeada por <Strong>{es.people.dev}</Strong> sin aceptar · “{hotfixReason.es}”
        </>
      ),
      sideTitle: 'Merged sin aceptar · 1',
      mergedWithoutAcceptance: 'merged sin aceptar',
      originBy: `origen: código · por ${es.people.dev}`,
      validate: 'Validar o corregir →',
    },
    released: {
      captions: [
        `Todos los checks pasan. ${es.people.dev} mergea la #${es.pr.number}.`,
        `${es.proposal.id} pasa sola a merged: sus deltas ya son la definición vigente.`,
        `${es.people.dev} publica v2.4.0 en GitHub…`,
        '…y es también una release del producto, con un changelog que cualquiera puede leer.',
      ],
      mergedNote: (
        <>
          {es.proposal.id} ya está <Strong>merged</Strong> en newt.
        </>
      ),
      currentDefinition: 'Definición vigente',
      ops: { new: 'nuevo', changed: 'cambiado', retired: 'retirado' },
      changelog: { changed: 'Cambiado', new: 'Nuevo' },
      more: `+ ${es.deltas.length - 3} más · de ${es.proposal.id}`,
      sameVersion: 'La misma versión que el código →',
    },
    cards: [
      { title: 'Enlazada como una issue', text: '“Implements PROP-42” en una PR funciona como “Closes #123”: al mergearla, la proposal pasa a merged en newt.' },
      { title: 'Anotada como un linter', text: 'Cada artifact tiene su línea en el informe, y los fallos aparecen en la línea del diff que los provoca.' },
      { title: 'Publicadas a la vez', text: 'Un release de GitHub es una release del producto: el changelog y el código siempre hablan de la misma versión.' },
    ],
  },
}
