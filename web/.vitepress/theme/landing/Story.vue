<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import { highlight } from './highlight'
import { useCopy } from './i18n'
import { reducedMotion, useTimers } from './motion'

/** How a backend rots as it grows, and what newt does about each: the code before, and with newt. */
const english = [
  {
    pain: 'The logic leaks into the routes',
    story: 'A handler validates, writes two tables and sends an email. Six months later, nobody dares to touch it.',
    answer: 'A route does not think',
    how: 'It reads the request, calls one use case, answers. The use case validates, asks who may, lets the entity change itself and saves once. The email leaves from a worker.',
    link: '/manual/06-use-cases',
    before: {
      file: 'routes/cards.ts',
      code: `app.post('/cards', async (req, res) => {
  const card = req.body as Card
  if (!card.title) return res.status(400).end()
  await db.query('INSERT INTO card …', [card])
  await db.query('UPDATE board SET cards = cards + 1')
  await mailer.send(card.assignee, 'New card')
  res.json(card)
})`,
      verdict: 'Validation, SQL, a mail and the answer, tangled in one handler.',
    },
    after: {
      file: 'cooper/…/card/card.routes.ts',
      code: `workspace.post('/boards/:boardId/cards', async request =>
  Response.json(
    await cards.create(request.params.boardId, await request.json()),
    { status: 201 },
  ),
  { idempotency: {
    table: base.store.table<KeptAnswer>('idempotency_key'),
  } })`,
      verdict: 'Reads, calls one use case, answers. Sent twice, done once.',
    },
  },
  {
    pain: 'Events get lost',
    story: 'The row is saved, the process restarts, the event is never published. The invoice is never sent, and nothing tells you.',
    answer: 'Events are born in the entity',
    how: 'The entity tracks what happened. The event is written in the same transaction as the change, and a worker runs every reaction until it succeeds.',
    link: '/manual/09-events',
    before: {
      file: 'services/cards.ts',
      code: `await db.insert('card', card)
// the process restarts right here
await queue.publish('card.created', card)
// nobody hears of this card. Ever.`,
      verdict: 'Two writes to two systems: one of them will fail alone.',
    },
    after: {
      file: 'cooper/…/card/card.ts',
      code: `static create(input: CardOpening, author: CardAuthor): Card {
  const card = new Card(input, true)
  card.author = author
  card.trackEvent(new Card_Created({ ...card.toDTO(), ...author }))
  return card
}
// card.module.ts: the card and its event, one transaction
await this.repo.persistNew(card)`,
      verdict: 'Saved with the change, told once it commits, never lost.',
    },
  },
  {
    pain: 'Two people, one record',
    story: 'Ana moves a card while Bob renames it. One of the changes silently disappears.',
    answer: 'Versions, and a second run',
    how: 'Every row has a version. A save that read an old one throws, and the use case runs again on fresh data: on SQLite, Postgres and MySQL alike.',
    link: '/manual/20-concurrency',
    before: {
      file: 'two tabs, one second apart',
      code: `-- Ana, 10:02:01
UPDATE card SET column_id = 'done' WHERE id = 42
-- Bob, 10:02:01, from what he read a second ago
UPDATE card SET title = 'Ship it', column_id = 'todo'
 WHERE id = 42
-- Ana's move is gone`,
      verdict: 'Last write wins, and nobody is told.',
    },
    after: {
      file: 'cooper/…/card/card.module.ts',
      code: `@UseCase()
async edit(id: string, input: unknown): Promise<CardDTO> {
  const changes = CardEditSchema.parse(input)
  const card = await this.load(id)
  card.edit(changes, actingAuthor())
  await this.repo.persist(card)   // an old version: run again
  return card.toDTO()
}`,
      verdict: 'A ConcurrencyConflict runs the use case again, up to 3 more times.',
    },
  },
  {
    pain: 'A tenant sees another\'s data',
    story: 'One forgotten where clause, and Acme reads Globex\'s boards.',
    answer: 'Scopes the repository keeps',
    how: 'A repository of tenant rows says its scope, and sees only the current one. Saving a row of another scope throws. A stranger gets a 404.',
    link: '/manual/22-tenants',
    before: {
      file: 'routes/boards.ts',
      code: `const board = await db.query(
  'SELECT * FROM board WHERE id = $1',
  [req.params.id],
)
// whose board? Acme's, Globex's, anyone's.`,
      verdict: 'Every query must remember the tenant. One will not.',
    },
    after: {
      file: 'cooper/…/card/card.repository.ts',
      code: `class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {
  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card'), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }
}
// find, page, count: only the current workspace's rows`,
      verdict: 'Said once, kept on every read and every save.',
    },
  },
  {
    pain: 'Nobody knows what calls what',
    story: 'Which module listens to card.created? What breaks if I change this payload? The answer lives in someone\'s head.',
    answer: 'The structure, declared and drawn',
    how: 'Every module declares what it uses. The lint keeps the boundaries, and the application describes itself to newt-monitor, which draws it.',
    link: '/manual/42-structure',
    before: {
      file: 'terminal',
      code: `$ grep -rn "card.created" src/
src/jobs/index.ts:12      emitter.on('card.created', …)
src/legacy/stats.ts:88    emitter.on('card.created', …)
src/billing/hooks.ts:301  // TODO: still used?`,
      verdict: 'Strings, a grep, and hope.',
    },
    after: {
      file: 'cooper/…/card/card.deps.ts',
      code: `export interface Card_Deps {
  board: Board_Module
  column: Column_Module
  member: Member_Module
  /** another context, by its module: never its tables */
  auth: { access: Access_Module }
}`,
      verdict: 'Typed, checked by the lint, drawn by the monitor.',
    },
  },
  {
    pain: 'AI writes code with no rails',
    story: 'Your coding agent is fast. It is also happy to write another module\'s rows from a request and call out mid-transaction.',
    answer: 'Rules a machine checks',
    how: 'An AGENTS.md versioned with the package, a lint that knows newt\'s anatomy, and runtime rules whose errors say what to do instead.',
    link: '/manual/33-agents',
    before: {
      file: 'label.module.ts, at 2 a.m.',
      code: `@UseCase()
async attach(cardId: string, input: unknown) {
  const { labelId } = LabelAttachSchema.parse(input)
  // straight into another module, from a request
  await this.deps.card.edit(cardId, { labelIds: [labelId] })
}`,
      verdict: 'Compiles. Ships. Breaks the boundaries you drew.',
    },
    after: {
      file: 'bun test',
      code: `✕ [write rule] label.attach writes to boards.card outside a
  worker: write it from a worker reacting to an event, or list
  it in its writesTo`,
      verdict: 'Refused the first time it runs, with what to do instead.',
    },
  },
]

const chapters = useCopy(english, [
  {
    pain: 'La lógica se cuela en las rutas',
    story: 'Un handler valida, escribe en dos tablas y manda un correo. Seis meses después, nadie se atreve a tocarlo.',
    answer: 'Una ruta no piensa',
    how: 'Lee la petición, llama a un caso de uso y responde. El caso de uso valida, pregunta quién puede, deja que la entidad cambie y guarda una vez. El correo sale desde un worker.',
    before: { verdict: 'Validación, SQL, un correo y la respuesta, enredados en un solo handler.' },
    after: { verdict: 'Lee, llama a un caso de uso y responde. Enviada dos veces, se hace una.' },
  },
  {
    pain: 'Los eventos se pierden',
    story: 'La fila se guarda, el proceso se reinicia y el evento nunca se publica. La factura no sale, y nada te avisa.',
    answer: 'Los eventos nacen en la entidad',
    how: 'La entidad registra lo que pasó. El evento se escribe en la misma transacción que el cambio, y un worker ejecuta cada reacción hasta que sale bien.',
    before: { file: 'services/cards.ts', verdict: 'Dos escrituras en dos sistemas: una fallará sola.' },
    after: { verdict: 'Se guarda con el cambio, se cuenta al hacer commit, nunca se pierde.' },
  },
  {
    pain: 'Dos personas, un registro',
    story: 'Ana mueve una tarjeta mientras Bob le cambia el nombre. Uno de los dos cambios desaparece sin hacer ruido.',
    answer: 'Versiones, y otra vuelta',
    how: 'Cada fila tiene una versión. Guardar desde una versión vieja lanza un error, y el caso de uso vuelve a ejecutarse con datos frescos: en SQLite, Postgres y MySQL por igual.',
    before: { file: 'dos pestañas, con un segundo de diferencia', verdict: 'Gana la última escritura, y nadie se entera.' },
    after: { verdict: 'Un ConcurrencyConflict vuelve a ejecutar el caso de uso, hasta 3 veces más.' },
  },
  {
    pain: 'Un cliente ve los datos de otro',
    story: 'Un where olvidado, y Acme lee los tableros de Globex.',
    answer: 'Ámbitos que guarda el repositorio',
    how: 'El repositorio de filas de un cliente dice su ámbito, y solo ve el actual. Guardar una fila de otro ámbito lanza un error. Un extraño recibe un 404.',
    before: { verdict: 'Cada consulta tiene que acordarse del cliente. Alguna no lo hará.' },
    after: { verdict: 'Se dice una vez, y se cumple en cada lectura y cada guardado.' },
  },
  {
    pain: 'Nadie sabe qué llama a qué',
    story: '¿Qué módulo escucha card.created? ¿Qué se rompe si cambio este payload? La respuesta vive en la cabeza de alguien.',
    answer: 'La estructura, declarada y dibujada',
    how: 'Cada módulo declara lo que usa. El lint guarda las fronteras, y la aplicación se describe a newt-monitor, que la dibuja.',
    before: { verdict: 'Cadenas de texto, un grep y fe.' },
    after: { verdict: 'Tipado, comprobado por el lint, dibujado por el monitor.' },
  },
  {
    pain: 'La IA escribe código sin raíles',
    story: 'Tu agente de código es rápido. Y también está encantado de escribir las filas de otro módulo desde una petición y llamar fuera en mitad de una transacción.',
    answer: 'Reglas que comprueba una máquina',
    how: 'Un AGENTS.md versionado con el paquete, un lint que conoce la anatomía de newt, y reglas en ejecución cuyos errores dicen qué hacer en su lugar.',
    before: { file: 'label.module.ts, a las 2 de la madrugada', verdict: 'Compila. Se despliega. Rompe las fronteras que dibujaste.' },
    after: { verdict: 'Rechazado la primera vez que se ejecuta, con lo que hay que hacer en su lugar.' },
  },
])
const ui = useCopy({ how: 'How it works →', without: 'Without newt', with: 'With newt', label: 'The code, without and with newt' }, { how: 'Cómo funciona →', without: 'Sin newt', with: 'Con newt', label: 'El código, sin newt y con newt' })

const active = ref(0)
const showing = ref<'before' | 'after'>('before')
const chapter = computed(() => chapters.value[active.value]!)
const code = computed(() => highlight(chapter.value[showing.value].code))
const timers = useTimers()

watch(active, () => {
  timers.clear()
  if (reducedMotion()) { showing.value = 'after'; return }
  showing.value = 'before'
  timers.after(1700, () => { showing.value = 'after' })
}, { immediate: true })

const items = ref<HTMLElement[]>([])
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) active.value = items.value.indexOf(entry.target as HTMLElement)
    }
  }, { rootMargin: '-45% 0px -45% 0px' })
  items.value.forEach(item => observer!.observe(item))
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="story">
    <ol class="chapters">
      <li v-for="(item, index) in chapters" :key="item.pain" ref="items" :class="{ on: index === active }">
        <span class="index">{{ String(index + 1).padStart(2, '0') }}</span>
        <p class="pain">{{ item.pain }}</p>
        <p class="tale">{{ item.story }}</p>
        <div class="answer">
          <span class="tick">✓</span>
          <div>
            <h3>{{ item.answer }}</h3>
            <p>{{ item.how }}</p>
            <a :href="withBase(item.link)">{{ ui.how }}</a>
          </div>
        </div>
        <div class="inline l-window" aria-hidden="true">
          <div class="l-window-bar"><i /><i /><i /><em>{{ item.after.file }}</em></div>
          <pre><code v-html="highlight(item.after.code)" /></pre>
        </div>
      </li>
    </ol>

    <div class="sticky">
      <div class="panel">
        <div class="switch" role="tablist" :aria-label="ui.label">
          <span class="thumb" :class="showing" />
          <button role="tab" :aria-selected="showing === 'before'" :class="{ on: showing === 'before' }" @click="timers.clear(); showing = 'before'">{{ ui.without }}</button>
          <button role="tab" :aria-selected="showing === 'after'" :class="{ on: showing === 'after' }" @click="timers.clear(); showing = 'after'">{{ ui.with }}</button>
        </div>
        <div class="l-window code" :class="showing">
          <div class="l-window-bar"><i /><i /><i /><em>{{ chapter[showing].file }}</em></div>
          <Transition name="swap" mode="out-in">
            <pre :key="active + showing"><code v-html="code" /></pre>
          </Transition>
        </div>
        <Transition name="swap" mode="out-in">
          <p :key="active + showing" class="verdict" :class="showing">
            <span>{{ showing === 'before' ? '✕' : '✓' }}</span>{{ chapter[showing].verdict }}
          </p>
        </Transition>
        <div class="dots" aria-hidden="true">
          <i v-for="(item, index) in chapters" :key="item.pain" :class="{ on: index === active }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.story { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: clamp(32px, 6vw, 88px); }
.chapters { list-style: none; }
.chapters li { min-height: 72vh; display: flex; flex-direction: column; justify-content: center; padding: 40px 0; opacity: .3; transition: opacity .6s ease; }
.chapters li.on { opacity: 1; }
.chapters li:first-child { min-height: 56vh; }
.index { font-family: var(--vp-font-family-mono); font-size: 12.5px; color: var(--l-red); letter-spacing: .06em; }
.pain { margin-top: 10px; font-size: clamp(26px, 3vw, 34px); line-height: 1.15; letter-spacing: -0.02em; font-weight: 650; color: var(--l-ink); }
.tale { margin-top: 14px; font-size: 16.5px; line-height: 1.7; color: var(--l-ink-2); }
.answer { display: flex; gap: 14px; margin-top: 28px; padding: 18px 0 0; border-top: 1px solid var(--l-border); }
.tick { flex: none; width: 20px; font-family: var(--vp-font-family-mono); font-size: 14px; font-weight: 700; color: var(--l-green-ink); }
.answer h3 { font-size: 17px; font-weight: 650; color: var(--l-green-ink); }
.answer p { margin-top: 6px; font-size: 15px; line-height: 1.65; color: var(--l-ink-2); }
.answer a { display: inline-block; margin-top: 10px; font-size: 14px; font-weight: 600; color: var(--l-green-ink); }
.answer a:hover { text-decoration: underline; text-underline-offset: 4px; }
.inline { display: none; margin-top: 20px; }

.sticky { position: relative; }
.panel { position: sticky; top: calc(var(--vp-nav-height, 64px) + 12vh); }
.switch { display: inline-flex; margin-bottom: 16px; border: 1px solid var(--l-border-strong); border-radius: 3px; overflow: hidden; }
.switch button { height: 34px; padding: 0 16px; font-size: 13.5px; font-weight: 600; color: var(--l-ink-3); transition: color .3s ease, background .3s ease; }
.switch button + button { border-left: 1px solid var(--l-border-strong); }
.switch button.on:first-of-type { color: var(--l-bg); background: var(--l-red); }
.switch button.on:last-of-type { color: var(--l-bg); background: var(--l-green); }
.thumb { display: none; }

.code { min-height: 300px; border-left-width: 3px; transition: border-color .5s ease; }
.code.before { border-left-color: var(--l-red); }
.code.after { border-left-color: var(--l-green); }

.verdict { display: flex; gap: 10px; align-items: baseline; margin-top: 16px; font-size: 15px; font-weight: 550; line-height: 1.5; }
.verdict span { font-family: var(--vp-font-family-mono); font-weight: 700; }
.verdict.before { color: var(--l-red); }
.verdict.after { color: var(--l-green-ink); }
.dots { display: flex; gap: 6px; margin-top: 22px; }
.dots i { width: 18px; height: 2px; background: var(--l-border-strong); transition: background .4s ease, width .4s ease; }
.dots i.on { width: 36px; background: var(--l-orange); }

.swap-enter-active, .swap-leave-active { transition: opacity .25s ease, transform .25s ease; }
.swap-enter-from { opacity: 0; transform: translateY(6px); }
.swap-leave-to { opacity: 0; transform: translateY(-6px); }

@media (max-width: 960px) {
  .story { grid-template-columns: minmax(0, 1fr); }
  .sticky { display: none; }
  .chapters li, .chapters li:first-child { min-height: 0; opacity: 1; padding: 36px 0; border-top: 1px solid var(--l-border); }
  .inline { display: block; }
}
</style>
