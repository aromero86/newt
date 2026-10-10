import type { ReactNode } from 'react'
import type { Bi } from '../../i18n'
import { Highlight } from '../../ui/site/section'
import type { BootstrapCopy } from '../../ui/scenes/infographics/bootstrap'
import type { BugsVsProposalsCopy } from '../../ui/scenes/infographics/bugs-vs-proposals'
import type { CurrentVsPlannedCopy } from '../../ui/scenes/infographics/current-vs-planned'
import type { GateCopy } from '../../ui/scenes/infographics/gate'
import type { VersionsCopy } from '../../ui/scenes/infographics/versions'
import type { ViewedDeltasCopy } from '../../ui/scenes/infographics/viewed-deltas'

type Copy = {
  eyebrow: string
  title: ReactNode
  intro: string
  currentVsPlanned: CurrentVsPlannedCopy
  gate: GateCopy
  viewedDeltas: ViewedDeltasCopy
  bootstrap: BootstrapCopy
  versions: VersionsCopy
  bugsVsProposals: BugsVsProposalsCopy
}

const stepLabelEn = (i: number, count: number) => `Show step ${i + 1} of ${count}`
const stepLabelEs = (i: number, count: number) => `Ver el paso ${i + 1} de ${count}`

// Product vocabulary (proposal, delta, revision, merged…), identifiers and
// versions stay the same in both languages.
export const content: Bi<Copy> = {
  en: {
    eyebrow: 'The ideas',
    title: (
      <>
        Six ideas behind <Highlight>newt</Highlight>
      </>
    ),
    intro: 'Each one plays on its own while it is on screen. Tap the dots to step through.',
    currentVsPlanned: {
      title: 'Current vs planned definition',
      lead: 'What the product does today, and what it will do once accepted proposals ship.',
      steps: [
        'PROP-42 is accepted: it joins the planned definition, waiting for its code.',
        'PR #318 implements it and gets merged on GitHub.',
        'PROP-42 is merged: the current definition catches up with the plan.',
      ],
      stepLabel: stepLabelEn,
      current: 'Current',
      currentHint: 'merged · in production',
      planned: 'Planned',
      plannedHint: 'current + accepted',
      everythingPlus: 'Everything in current, plus:',
      nothingPending: 'Nothing pending: planned = current',
    },
    gate: {
      title: 'The gate checks everything',
      lead: 'Before a proposal is accepted, newt checks every delta against the whole planned definition, block by block.',
      stepLabel: stepLabelEn,
      blocks: ['Catalog', 'Accounts', 'Checkout › Payments', 'Orders', 'Shipping', 'Backoffice'],
      checking: (id, block) => `Revision 1: checking ${id}'s deltas against ${block}…`,
      conflict: explanation => `Conflict: ${explanation}`,
      stillChecking: block => `The conflict stays open. Still checking ${block}: the gate reviews everything.`,
      revision2: 'Revision 2 caps Δ1 at €500. Only the changed delta is checked again.',
      noConflicts: 'No conflicts detected: PROP-42 can be accepted.',
      resolved: '— resolved in revision 2: guests pay with Bizum up to €500.',
    },
    viewedDeltas: {
      title: 'Deltas work like viewed files',
      lead: "Iterating a proposal doesn't reset the review: approved deltas that don't change stay approved.",
      steps: [
        'Revision 1: newt extracts five deltas from the document. All pending.',
        'Reviewers approve them one by one.',
        'Revision 2 edits one paragraph. Only Δ1 changed: it goes back to pending, showing what changed.',
        'Δ1 is approved again. The other four never had to be looked at twice.',
      ],
      stepLabel: stepLabelEn,
      changedSinceApproval: 'changed since your approval',
    },
    bootstrap: {
      title: 'Bootstrap from your codebase',
      lead: 'Nobody writes the definition of an existing product by hand. newt starts from the code.',
      steps: [
        'Point newt at an existing repository.',
        'Claude reads the code: models, guards, state machines, config.',
        'It writes one big bootstrap proposal with everything the code already does.',
        'The team reviews it by area and accepts it. The product is defined.',
      ],
      stepLabel: stepLabelEn,
      proposalName: 'Bootstrap',
      mergedNote:
        'Its code already exists, so it goes straight to merged. 3 contradictions found in the code show up as conflicts to review.',
    },
    versions: {
      title: 'Product and code share one version',
      lead: 'A proposal is merged when its code is. A release is the same moment in newt and on GitHub.',
      steps: [
        'v2.3.0: the same version on both sides.',
        'Proposals get merged as their PRs get merged on GitHub.',
        'PROP-42 lands with PR #318.',
        'A GitHub release creates the product release: v2.4.0, with its changelog.',
      ],
      stepLabel: stepLabelEn,
      productLane: 'Product · newt',
      codeLane: 'Code · GitHub',
      changed: 'Changed',
      new: 'New',
      was: '(was:',
      orderLifecycle: 'Order lifecycle:',
    },
    bugsVsProposals: {
      title: 'Bugs are not proposals',
      lead: 'Like an issue and a pull request: a bug says the product misbehaves; a proposal changes what it should do.',
      steps: [
        'Monitoring reports a crash. Repeats become occurrences of BUG-77, not new bugs.',
        'Reproduced: BUG-77 is confirmed and linked to the lifecycle it breaks.',
        'The code was wrong: a fix PR resolves it. The definition does not change.',
        'Or fixing it needs a decision: a correction proposal changes the definition first.',
      ],
      stepLabel: stepLabelEn,
      occurrences: 'occurrences',
      breaks: 'breaks',
      fixPrTitle: 'fix(orders): keep order awaiting Bizum on timeout',
      resolves: id => `resolves ${id}`,
      correctionTitle: 'correction: cancel unpaid Bizum orders after 15 min',
      compareRows: ['Changes the definition', 'Has deltas', 'Goes through the gate', 'Linked to artifacts'],
      yes: 'yes',
    },
  },
  es: {
    eyebrow: 'Las ideas',
    title: (
      <>
        Seis ideas detrás de <Highlight>newt</Highlight>
      </>
    ),
    intro: 'Cada una se reproduce sola mientras está en pantalla. Toca los puntos para ir paso a paso.',
    currentVsPlanned: {
      title: 'Definición vigente y prevista',
      lead: 'Lo que hace hoy el producto, y lo que hará cuando salgan las proposals aceptadas.',
      steps: [
        'PROP-42 se acepta: entra en la definición prevista, a la espera de su código.',
        'La PR #318 la implementa y se mergea en GitHub.',
        'PROP-42 pasa a merged: la definición vigente alcanza a la prevista.',
      ],
      stepLabel: stepLabelEs,
      current: 'Vigente',
      currentHint: 'merged · en producción',
      planned: 'Prevista',
      plannedHint: 'vigente + accepted',
      everythingPlus: 'Todo lo vigente, y además:',
      nothingPending: 'Nada pendiente: prevista = vigente',
    },
    gate: {
      title: 'La puerta lo revisa todo',
      lead: 'Antes de aceptar una proposal, newt comprueba cada delta contra toda la definición prevista, bloque a bloque.',
      stepLabel: stepLabelEs,
      blocks: ['Catálogo', 'Cuentas', 'Checkout › Pagos', 'Pedidos', 'Envíos', 'Backoffice'],
      checking: (id, block) => `Revision 1: comprobando los deltas de ${id} contra ${block}…`,
      conflict: explanation => `Conflicto: ${explanation}`,
      stillChecking: block => `El conflicto sigue abierto. Sigue comprobando ${block}: la puerta lo revisa todo.`,
      revision2: 'La revision 2 limita Δ1 a 500 €. Solo se vuelve a comprobar el delta que cambió.',
      noConflicts: 'No se detectan conflictos: PROP-42 se puede aceptar.',
      resolved: '— resuelto en la revision 2: los invitados pagan con Bizum hasta 500 €.',
    },
    viewedDeltas: {
      title: 'Los deltas funcionan como ficheros vistos',
      lead: 'Iterar una proposal no reinicia la revisión: los deltas aprobados que no cambian siguen aprobados.',
      steps: [
        'Revision 1: newt extrae cinco deltas del documento. Todos pending.',
        'Quienes revisan los aprueban uno a uno.',
        'La revision 2 cambia un párrafo. Solo cambió Δ1: vuelve a pending y enseña qué cambió.',
        'Δ1 se vuelve a aprobar. Los otros cuatro no hubo que mirarlos dos veces.',
      ],
      stepLabel: stepLabelEs,
      changedSinceApproval: 'cambió desde tu aprobación',
    },
    bootstrap: {
      title: 'Arranca desde tu código',
      lead: 'Nadie escribe a mano la definición de un producto que ya existe. newt empieza por el código.',
      steps: [
        'Apunta newt a un repositorio que ya existe.',
        'Claude lee el código: modelos, guards, máquinas de estados, configuración.',
        'Escribe una gran proposal de arranque con todo lo que el código ya hace.',
        'El equipo la revisa por áreas y la acepta. El producto queda definido.',
      ],
      stepLabel: stepLabelEs,
      proposalName: 'Arranque',
      mergedNote:
        'Su código ya existe, así que pasa directamente a merged. Las 3 contradicciones encontradas en el código aparecen como conflictos a revisar.',
    },
    versions: {
      title: 'Producto y código comparten versión',
      lead: 'Una proposal pasa a merged cuando su código se mergea. Una release es el mismo momento en newt y en GitHub.',
      steps: [
        'v2.3.0: la misma versión en los dos lados.',
        'Las proposals pasan a merged cuando sus PRs se mergean en GitHub.',
        'PROP-42 llega con la PR #318.',
        'Un release de GitHub crea la release de producto: v2.4.0, con su changelog.',
      ],
      stepLabel: stepLabelEs,
      productLane: 'Producto · newt',
      codeLane: 'Código · GitHub',
      changed: 'Cambiado',
      new: 'Nuevo',
      was: '(antes:',
      orderLifecycle: 'Lifecycle de Order:',
    },
    bugsVsProposals: {
      title: 'Un bug no es una proposal',
      lead: 'Como una issue y una pull request: un bug dice que el producto falla; una proposal cambia lo que debe hacer.',
      steps: [
        'La monitorización avisa de un crash. Las repeticiones son ocurrencias de BUG-77, no bugs nuevos.',
        'Reproducido: BUG-77 se confirma y se enlaza al lifecycle que rompe.',
        'El código estaba mal: una PR de corrección lo resuelve. La definición no cambia.',
        'O arreglarlo pide una decisión: una proposal de corrección cambia antes la definición.',
      ],
      stepLabel: stepLabelEs,
      occurrences: 'ocurrencias',
      breaks: 'rompe',
      fixPrTitle: 'fix(orders): mantener el pedido esperando Bizum si caduca',
      resolves: id => `resuelve ${id}`,
      correctionTitle: 'corrección: cancelar los pedidos de Bizum sin pagar a los 15 min',
      compareRows: ['Cambia la definición', 'Tiene deltas', 'Pasa por la puerta', 'Enlazado a artifacts'],
      yes: 'sí',
    },
  },
}
