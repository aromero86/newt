import type { Bi } from '../../i18n'
import type { StagesCopy } from '../../ui/scenes/how/stages'
import type { HowStep } from '../../ui/scenes/how/steps'

type HowCopy = {
  eyebrow: string
  title: string
  intro: string
  steps: HowStep[]
  stages: StagesCopy
}

export const content: Bi<HowCopy> = {
  en: {
    eyebrow: 'How it works',
    title: 'From a sentence to production, without losing the thread.',
    intro:
      'One change, end to end: a product manager asks for something, newt keeps it coherent, a developer ships it, and the definition of the product is never out of date.',
    steps: [
      {
        who: 'Product',
        title: 'Describe the change, in your words',
        text: 'Talk to Claude. It reads the current definition through newt, finds what is affected and asks what is not clear instead of guessing.',
      },
      {
        who: 'Claude',
        title: 'A proposal is written',
        text: 'Claude writes the proposal document: context, problem and decisions. The document is the single source of the change.',
      },
      {
        who: 'newt',
        title: 'newt extracts the deltas',
        text: 'Every concrete change to the definition becomes a delta: a rule changed, a state added to a lifecycle, a new parameter. Deltas are what gets approved, checked and shipped.',
      },
      {
        who: 'newt',
        title: 'The gate checks the whole definition',
        text: 'Not just what looks related: every artifact, in batches, with a closer look where scopes overlap. Conflicts come with an explanation, next to the delta that causes them.',
      },
      {
        who: 'Product',
        title: 'Iterate without starting over',
        text: 'Edit the document and newt re-extracts the deltas. What did not change keeps its approval — like files marked “viewed” in a GitHub review.',
      },
      {
        who: 'Product',
        title: 'Accepted means ready for development',
        text: 'Every delta approved and the gate passed: the proposal is accepted, frozen, and lands in the development backlog. The planned definition moves ahead.',
      },
      {
        who: 'Development',
        title: 'The pull request is checked against it',
        text: 'The PR declares the proposal it implements. newt checks the code against it and against the current definition, artifact by artifact, right in the diff.',
      },
      {
        who: 'Development',
        title: 'Merge, and the definition moves',
        text: 'When the PR that completes the proposal is merged, the proposal becomes merged and its deltas join the current definition. Nobody updates a doc by hand.',
      },
      {
        who: 'Everyone',
        title: 'Product and code ship as one version',
        text: 'A GitHub release creates the product release, with a changelog of what changed in the product and why.',
      },
    ],
    stages: {
      chatTitle: 'Claude · connected to newt',
      tabs: { document: 'Document', checks: 'Checks' },
      ops: { new: 'new', changed: 'changed', retired: 'retired' },
      viewed: id => `Viewed ${id}`,
      talk: {
        search: 'guests pay',
        headsUp: 'Heads up: today ',
        says: ' says ',
        and: ' and ',
        questions: ' requires an account over €500. Should guests pay with Bizum only? Up to what amount? And where does their invoice go?',
        reply: 'Bizum only, up to €500. Invoice to the email they give us.',
        done: 'Done: ',
        ready: ' is ready for review. ',
        open: 'Open it in newt',
      },
      document: {
        withClaude: 'with Claude',
        context: 'Context',
        decision: 'Decision',
        openQuestions: 'Open questions',
        noneLeft: 'None left: Claude asked about amount and invoices.',
        singleSource: 'the document is the single source',
      },
      deltas: { extracted: 'Extracted from the document · revision 1' },
      gate: {
        checking: 'Checking against the planned definition',
        consistent: 'consistent',
        overlapping: 'overlapping scope, looked at closely',
        conflict: 'conflict',
        conflictTitle: 'Conflict',
        changeProposal: 'Change the proposal',
        notConflict: 'Not a conflict (give a reason)',
        cannotAccept: 'Cannot be accepted: 1 open conflict',
      },
      iterate: {
        upTo: 'up to €500',
        changedSince: 'Changed since you approved it · conflict with R-07 resolved',
        unchanged: 'Unchanged since you approved it',
        allApproved: '5 of 5 deltas approved · gate passed · 0 conflicts',
      },
      accepted: {
        columns: { product: 'Product', todo: 'To do', doing: 'In progress' },
        current: 'Current definition',
        planned: 'Planned definition',
        plannedLabel: 'Planned definition:',
        plannedSummary: '1 rule changed, 1 rule added, Order lifecycle +1 state, 1 new parameter',
        cards: { mexico: 'Shipping rules for Mexico', history: 'Order history for guests', loyalty: 'Loyalty points' },
        cardTitle: 'Guests pay with Bizum',
        surface: 'surface: Mobile app',
      },
      pr: {
        implements: 'Implements',
        ruleNote: id => `“Payments over €500 require a registered account.” This line lets Bizum skip the limit accepted in ${id} (Δ1: up to €500).`,
        summary: '2 pass, 1 failing, 1 warning',
        limit: '€500 limit',
        noTest: '“awaiting Bizum” has no test',
      },
      merged: {
        allPassed: 'all checks passed (4 artifacts, 4 tests)',
        marked: 'marked',
        as: 'as',
        current: 'Current definition',
        lifecycle: 'created → awaiting Bizum → paid → shipped',
      },
      release: {
        whatChanged: 'What changed in the product',
        added: 'New',
        changed: 'Changed',
        changedText: 'Guests can pay with Bizum, up to €500, in the app.',
        why: 'Why: guests abandon checkout when asked to sign up.',
      },
    },
  },
  es: {
    eyebrow: 'Cómo funciona',
    title: 'De una frase a producción, sin perder el hilo.',
    intro:
      'Un cambio de punta a punta: alguien de producto pide algo, newt lo mantiene coherente, desarrollo lo implementa y la definición del producto nunca se queda desactualizada.',
    steps: [
      {
        who: 'Producto',
        title: 'Cuenta el cambio con tus palabras',
        text: 'Habla con Claude. Lee la definición vigente a través de newt, encuentra lo afectado y pregunta lo que no está claro en vez de suponerlo.',
      },
      {
        who: 'Claude',
        title: 'Se escribe una proposal',
        text: 'Claude escribe el documento de la proposal: contexto, problema y decisiones. El documento es la única fuente del cambio.',
      },
      {
        who: 'newt',
        title: 'newt extrae los deltas',
        text: 'Cada cambio concreto en la definición es un delta: una rule que cambia, un estado nuevo en un lifecycle, un parameter nuevo. Los deltas son lo que se aprueba, se comprueba y se publica.',
      },
      {
        who: 'newt',
        title: 'La puerta revisa toda la definición',
        text: 'No solo lo que parece relacionado: todos los artifacts, por bloques, y con más detalle donde los alcances se solapan. Los conflictos llegan explicados, junto al delta que los causa.',
      },
      {
        who: 'Producto',
        title: 'Itera sin empezar de cero',
        text: 'Edita el documento y newt vuelve a extraer los deltas. Lo que no ha cambiado conserva su aprobación, como los ficheros marcados como «viewed» en una revisión de GitHub.',
      },
      {
        who: 'Producto',
        title: 'Accepted significa lista para desarrollo',
        text: 'Todos los deltas aprobados y la puerta superada: la proposal pasa a accepted, queda congelada y entra en el backlog de desarrollo. La definición prevista avanza.',
      },
      {
        who: 'Desarrollo',
        title: 'La pull request se comprueba contra ella',
        text: 'La PR declara qué proposal implementa. newt comprueba el código contra ella y contra la definición vigente, artifact por artifact, en el propio diff.',
      },
      {
        who: 'Desarrollo',
        title: 'Merge, y la definición avanza',
        text: 'Cuando se mergea la PR que completa la proposal, pasa a merged y sus deltas entran en la definición vigente. Nadie actualiza un documento a mano.',
      },
      {
        who: 'Todos',
        title: 'Producto y código salen en una sola versión',
        text: 'Un release de GitHub crea la release de producto, con un changelog de qué cambió en el producto y por qué.',
      },
    ],
    stages: {
      chatTitle: 'Claude · conectado a newt',
      tabs: { document: 'Documento', checks: 'Comprobaciones' },
      ops: { new: 'nuevo', changed: 'cambiado', retired: 'retirado' },
      viewed: id => `${id} visto`,
      talk: {
        search: 'invitados pagan',
        headsUp: 'Ojo: hoy ',
        says: ' dice ',
        and: ' y ',
        questions: ' exige cuenta por encima de 500 €. ¿Los invitados pagan solo con Bizum? ¿Hasta qué importe? ¿Y adónde va su factura?',
        reply: 'Solo Bizum, hasta 500 €. La factura, al email que nos den.',
        done: 'Hecho: ',
        ready: ' está lista para revisar. ',
        open: 'Ábrela en newt',
      },
      document: {
        withClaude: 'con Claude',
        context: 'Contexto',
        decision: 'Decisión',
        openQuestions: 'Preguntas abiertas',
        noneLeft: 'Ninguna: Claude preguntó por el importe y las facturas.',
        singleSource: 'el documento es la única fuente',
      },
      deltas: { extracted: 'Extraídos del documento · revision 1' },
      gate: {
        checking: 'Comprobando contra la definición prevista',
        consistent: 'coherente',
        overlapping: 'alcance solapado, revisado de cerca',
        conflict: 'conflicto',
        conflictTitle: 'Conflicto',
        changeProposal: 'Cambiar la proposal',
        notConflict: 'No es conflicto (con motivo)',
        cannotAccept: 'No se puede aceptar: 1 conflicto abierto',
      },
      iterate: {
        upTo: 'hasta 500 €',
        changedSince: 'Ha cambiado desde que lo aprobaste · conflicto con R-07 resuelto',
        unchanged: 'Sin cambios desde que lo aprobaste',
        allApproved: '5 de 5 deltas aprobados · puerta superada · 0 conflictos',
      },
      accepted: {
        columns: { product: 'Producto', todo: 'Por hacer', doing: 'En curso' },
        current: 'Definición vigente',
        planned: 'Definición prevista',
        plannedLabel: 'Definición prevista:',
        plannedSummary: '1 rule cambiada, 1 rule nueva, lifecycle Order +1 estado, 1 parameter nuevo',
        cards: { mexico: 'Reglas de envío para México', history: 'Historial de pedidos para invitados', loyalty: 'Puntos de fidelidad' },
        cardTitle: 'Invitados pagan con Bizum',
        surface: 'superficie: App móvil',
      },
      pr: {
        implements: 'Implementa',
        ruleNote: id => `«Los pagos de más de 500 € requieren una cuenta registrada.» Esta línea deja que Bizum se salte el límite aceptado en ${id} (Δ1: hasta 500 €).`,
        summary: '2 se cumplen, 1 falla, 1 aviso',
        limit: 'límite de 500 €',
        noTest: '«esperando Bizum» no tiene test',
      },
      merged: {
        allPassed: 'todo en verde (4 artifacts, 4 tests)',
        marked: 'marcó',
        as: 'como',
        current: 'Definición vigente',
        lifecycle: 'creado → esperando Bizum → pagado → enviado',
      },
      release: {
        whatChanged: 'Qué cambió en el producto',
        added: 'Nuevo',
        changed: 'Cambiado',
        changedText: 'Los invitados pueden pagar con Bizum, hasta 500 €, en la app.',
        why: 'Por qué: los invitados abandonan el checkout cuando les pedimos registrarse.',
      },
    },
  },
}
