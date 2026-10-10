import type { Bi } from '../../i18n'
import type { ClashCopy } from '../../ui/scenes/problem/clash'
import type { QueueCopy } from '../../ui/scenes/problem/queue'

type Card = { title: string; text: string }

/** Every text of the problem section, in both languages. */
export const content: Bi<{
  eyebrow: string
  title: string
  lead: string
  drift: Card & { docs: string; code: string }
  clash: Card & ClashCopy
  queue: Card & QueueCopy
}> = {
  en: {
    eyebrow: 'The problem',
    title: 'Nobody knows for sure how the product should behave.',
    lead: "What the product must do lives in docs, tickets, chats and a few people's heads. The only real source of truth is the code — bugs included. And more and more of that code is written by agents.",
    drift: {
      title: 'Product and code drift apart',
      text: 'The spec said one thing, the code does another, and six months later nobody remembers which one is right.',
      docs: 'what the docs say',
      code: 'what the code does',
    },
    clash: {
      title: 'Rules contradict each other',
      text: 'A decision from last spring clashes with one from yesterday. You find out in production.',
      rule: { when: 'March', text: 'Payments over €500 require an account.' },
      ticket: { when: 'yesterday', text: 'Guests can pay any amount with Bizum.' },
      found: 'found in production',
    },
    queue: {
      title: 'Reviewing agent PRs is the bottleneck',
      text: 'Code review checks that code is well written. Nobody checks that the product still does what it should.',
      prs: ['Bizum for guests', 'Refactor cart totals', 'Shipping rules MX', 'Fix invoice email', 'New admin roles', 'Order states'],
      reviewer: '1 reviewer',
      waiting: 'waiting',
    },
  },
  es: {
    eyebrow: 'El problema',
    title: 'Nadie sabe con certeza cómo debe comportarse el producto.',
    lead: 'Lo que el producto debe hacer vive repartido en documentos, tickets, chats y la cabeza de unas pocas personas. La única fuente de verdad real es el código, con sus bugs incluidos. Y cada vez más de ese código lo escriben agentes.',
    drift: {
      title: 'Producto y código se separan',
      text: 'La especificación decía una cosa, el código hace otra y seis meses después nadie recuerda cuál era la buena.',
      docs: 'lo que dicen los docs',
      code: 'lo que hace el código',
    },
    clash: {
      title: 'Las reglas se contradicen',
      text: 'Una decisión de la primavera pasada choca con una de ayer. Te enteras en producción.',
      rule: { when: 'marzo', text: 'Los pagos de más de 500 € requieren cuenta.' },
      ticket: { when: 'ayer', text: 'Los invitados pueden pagar cualquier importe con Bizum.' },
      found: 'descubierto en producción',
    },
    queue: {
      title: 'Revisar las PRs de agentes es el cuello de botella',
      text: 'La revisión de código comprueba que el código está bien escrito. Nadie comprueba que el producto siga haciendo lo que debe.',
      prs: ['Bizum para invitados', 'Refactor de totales del carrito', 'Reglas de envío MX', 'Arreglar email de factura', 'Nuevos roles de admin', 'Estados del pedido'],
      reviewer: '1 revisor',
      waiting: 'en espera',
    },
  },
}
