<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { withBase } from 'vitepress'
import Hero from './Hero.vue'
import Story from './Story.vue'
import ModelExplorer from './ModelExplorer.vue'
import ChangeTracking from './ChangeTracking.vue'
import RequestJourney from './RequestJourney.vue'
import MonitorShowcase from './MonitorShowcase.vue'
import AskClaude from './AskClaude.vue'
import AgentTerminal from './AgentTerminal.vue'
import Bento from './Bento.vue'
import Counter from './Counter.vue'
import Shot from './Shot.vue'
import { useCopy } from './i18n'
import { reducedMotion } from './motion'
import './landing.css'

/** What scrolls into view fades in, once. */
let observer: IntersectionObserver | undefined
onMounted(() => {
  const revealed = document.querySelectorAll('.landing .l-reveal')
  if (reducedMotion() || !('IntersectionObserver' in window)) revealed.forEach(element => element.classList.add('is-in'))
  else {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.boundingClientRect.top > 0) continue
        entry.target.classList.add('is-in')
        observer?.unobserve(entry.target)
      }
    }, { threshold: 0.08 })
    revealed.forEach(element => observer!.observe(element))
  }
})
onBeforeUnmount(() => observer?.disconnect())

/** What a log says, line after line. */
const logs = [
  'POST /api/workspaces/01a1…/boards/01a1…/cards 201 4ms',
  'GET  /api/workspaces/01a1…/boards 200 1ms',
  'POST /api/workspaces/01a1…/boards/01a1…/cards 400 0ms',
  'job failed, retrying in 32s',
  'GET  /api/workspaces/01a1…/cards/01a1… 404 0ms',
  'PATCH /api/workspaces/01a1…/cards/01a1… 200 2ms',
  'Error: connect ECONNREFUSED 10.0.3.7:587',
  'GET  /api/me 200 0ms',
  'job failed, retrying in 64s',
  'POST /oauth/token 200 3ms',
]
const insights = [
  { code: 'card.create', ctx: 'boards' },
  { code: 'card.notifyAssignee.on.card.created', ctx: 'boards' },
  { code: 'access.check', ctx: 'auth' },
]
const numbers = [{ to: 158986 }, { to: 0 }, { to: 0.39, decimals: 2, suffix: ' ms' }, { to: 0.94, decimals: 2, suffix: ' ms' }]

const copy = useCopy({
  story: { eyebrow: 'The problem', title: 'Every backend starts clean.', rest: 'Then it grows.', lead: 'Six ways a backend rots as it grows, and what newt does about each: the code without it, and with it.' },
  model: { eyebrow: 'The model', title: 'Contexts, modules, and how they talk.', rest: 'Boundaries that hold.', lead: 'An application is bounded contexts. A context is modules, each owning one entity. A module asks another to read, and hears another to write. Four steps, and you know where everything goes.' },
  changes: { eyebrow: 'Change tracking', title: 'You change the entity.', rest: 'newt does the rest.', lead: 'You never write an UPDATE, never diff, never publish. The entity knows what changed and tells it; the repository writes only that, guarded by its version, and the event leaves in the same transaction. A change undone writes nothing and tells nothing.' },
  journey: { eyebrow: 'One request', title: 'One request, end to end.', rest: 'Replayed from its trace.', lead: 'One card created in cooper, newt\'s example application, as newt-monitor kept it: three contexts, a rate limit, an idempotency key, one transaction, one event and four workers.' },
  monitor: {
    eyebrow: 'newt-monitor', title: 'Production, explained', rest: 'in your own words.',
    lead: 'Your application already knows its contexts, modules, use cases, events and queues. newt-monitor asks it, and shows you every one of them running: not routes and status codes, but what your code calls things.',
    logs: 'Your logs say', says: 'newt-monitor says',
    insights: [
      '591 errors in the hour, all of them ones it says may happen. 0 failures. p90 1 ms.',
      'Died after 5 attempts: MailNotSent, the mail server at smtp.cooper.dev:587 refused the connection.',
      '0.1 ms of a 4 ms request to boards: the other context, asked through its use case.',
    ],
    numbers: ['use case calls in an hour', 'failures nobody expected', 'mean of every use case', 'p90 of every use case'],
    note: 'cooper under a load test, as newt-monitor counted it.',
    promises: [
      { title: 'It knows your domain', text: 'Contexts, modules, use cases, events, queues and schedules as your code names them, and each use case\'s errors by their codes.' },
      { title: 'It never opens your database', text: 'The monitor asks; your application answers on a port of its own, every request signed. Payloads and rows stay where they are.' },
      { title: 'One monitor, every application', text: 'Register as many as you run. Each deploy is marked on every chart, and each version of their structure is kept to compare.' },
    ],
    cta: 'Meet newt-monitor',
  },
  rest: { eyebrow: 'And the rest', title: 'What a real backend needs,', rest: 'from the first module.' },
  cooper: { eyebrow: 'Learn it on a real application', title: 'Meet cooper.', lead: 'Boards of cards for teams: three contexts, sign-in through an OAuth server of its own, workspaces, invitations, search, a backoffice and an MCP server. The book explains every part of newt through it, with the code in front of you.', go: 'Meet cooper', board: 'A board in cooper, with its columns and cards', backoffice: 'cooper\'s backoffice' },
  end: { title: 'Build something that lasts.', lead: 'Start with the essentials: fourteen chapters, from why newt exists to running it in production. Then go as deep as you like.', read: 'Read the book', monitor: 'The monitor', note: '' },
}, {
  story: { eyebrow: 'El problema', title: 'Todo backend empieza limpio.', rest: 'Luego crece.', lead: 'Seis maneras en que un backend se pudre al crecer, y qué hace newt con cada una: el código sin newt, y con él.' },
  model: { eyebrow: 'El modelo', title: 'Contextos, módulos y cómo se hablan.', rest: 'Fronteras que aguantan.', lead: 'Una aplicación son contextos delimitados. Un contexto son módulos, cada uno dueño de una entidad. Un módulo pregunta a otro para leer, y escucha a otro para escribir. Cuatro pasos, y sabes dónde va cada cosa.' },
  changes: { eyebrow: 'Seguimiento de cambios', title: 'Tú cambias la entidad.', rest: 'newt hace el resto.', lead: 'Nunca escribes un UPDATE, ni calculas un diff, ni publicas nada. La entidad sabe qué cambió y lo cuenta; el repositorio escribe solo eso, protegido por su versión, y el evento sale en la misma transacción. Un cambio deshecho no escribe nada ni cuenta nada.' },
  journey: { eyebrow: 'Una petición', title: 'Una petición, de principio a fin.', rest: 'Reproducido desde su traza.', lead: 'Una tarjeta creada en cooper, la aplicación de ejemplo de newt, tal como la guardó newt-monitor: tres contextos, un rate limit, una clave de idempotencia, una transacción, un evento y cuatro workers.' },
  monitor: {
    eyebrow: 'newt-monitor', title: 'Producción, explicada', rest: 'con tus propias palabras.',
    lead: 'Tu aplicación ya conoce sus contextos, módulos, casos de uso, eventos y colas. newt-monitor se lo pregunta, y te enseña cada uno funcionando: no rutas y códigos de estado, sino las cosas por el nombre que les da tu código.',
    logs: 'Tus logs dicen', says: 'newt-monitor dice',
    insights: [
      '591 errores en la hora, todos de los que dice que pueden pasar. 0 fallos. p90 de 1 ms.',
      'Muerto tras 5 intentos: MailNotSent, el servidor de correo en smtp.cooper.dev:587 rechazó la conexión.',
      '0,1 ms de una petición de 4 ms a boards: el otro contexto, preguntado por su caso de uso.',
    ],
    numbers: ['llamadas a casos de uso en una hora', 'fallos que nadie esperaba', 'media de todos los casos de uso', 'p90 de todos los casos de uso'],
    note: 'cooper bajo una prueba de carga, según lo contó newt-monitor.',
    promises: [
      { title: 'Conoce tu dominio', text: 'Contextos, módulos, casos de uso, eventos, colas y tareas programadas tal como los nombra tu código, y los errores de cada caso de uso por su código.' },
      { title: 'Nunca abre tu base de datos', text: 'El monitor pregunta; tu aplicación responde en un puerto propio, con cada petición firmada. Los payloads y las filas se quedan donde están.' },
      { title: 'Un monitor, todas tus aplicaciones', text: 'Registra todas las que tengas. Cada despliegue queda marcado en cada gráfica, y cada versión de su estructura se guarda para compararla.' },
    ],
    cta: 'Conoce newt-monitor',
  },
  rest: { eyebrow: 'Y el resto', title: 'Lo que un backend de verdad necesita,', rest: 'desde el primer módulo.' },
  cooper: { eyebrow: 'Apréndelo en una aplicación real', title: 'Te presento a cooper.', lead: 'Tableros de tarjetas para equipos: tres contextos, inicio de sesión con un servidor OAuth propio, espacios de trabajo, invitaciones, búsqueda, un backoffice y un servidor MCP. El libro explica cada parte de newt a través de él, con el código delante.', go: 'Conoce cooper', board: 'Un tablero en cooper, con sus columnas y tarjetas', backoffice: 'El backoffice de cooper' },
  end: { title: 'Construye algo que dure.', lead: 'Empieza por lo esencial: catorce capítulos, desde por qué existe newt hasta llevarlo a producción. Luego, tan a fondo como quieras.', read: 'Leer el libro', monitor: 'El monitor', note: 'El libro está en inglés.' },
})
</script>

<template>
  <div class="landing">
    <Hero />

    <section id="story" class="l-section">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow"><b>01</b> {{ copy.story.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.story.title }} <span class="l-ink">{{ copy.story.rest }}</span></h2>
          <p class="l-lead">{{ copy.story.lead }}</p>
        </header>
        <Story />
      </div>
    </section>

    <section id="model" class="l-section">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow"><b>02</b> {{ copy.model.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.model.title }} <span class="l-ink">{{ copy.model.rest }}</span></h2>
          <p class="l-lead">{{ copy.model.lead }}</p>
        </header>
        <ModelExplorer class="l-reveal" />
      </div>
    </section>

    <section id="changes" class="l-section">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow"><b>03</b> {{ copy.changes.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.changes.title }} <span class="l-ink">{{ copy.changes.rest }}</span></h2>
          <p class="l-lead">{{ copy.changes.lead }}</p>
        </header>
        <ChangeTracking class="l-reveal" />
      </div>
    </section>

    <section id="journey" class="l-section tint">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow"><b>04</b> {{ copy.journey.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.journey.title }} <span class="l-ink">{{ copy.journey.rest }}</span></h2>
          <p class="l-lead">{{ copy.journey.lead }}</p>
        </header>
        <RequestJourney class="l-reveal" />
      </div>
    </section>

    <section id="monitor" class="l-section">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow"><b>05</b> {{ copy.monitor.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.monitor.title }} <span class="l-ink">{{ copy.monitor.rest }}</span></h2>
          <p class="l-lead">{{ copy.monitor.lead }}</p>
        </header>

        <div class="versus l-reveal">
          <div>
            <p class="tag">{{ copy.monitor.logs }}</p>
            <div class="log-window"><code v-for="line in logs" :key="line">{{ line }}</code></div>
          </div>
          <div>
            <p class="tag good">{{ copy.monitor.says }}</p>
            <div class="insights">
              <div v-for="(insight, index) in insights" :key="insight.code" class="insight">
                <div class="insight-head"><code>{{ insight.code }}</code><span class="ctx" :class="insight.ctx">{{ insight.ctx }}</span></div>
                <p>{{ copy.monitor.insights[index] }}</p>
              </div>
            </div>
          </div>
        </div>

        <MonitorShowcase class="l-reveal" />

        <div class="numbers l-reveal">
          <div v-for="(number, index) in numbers" :key="index" class="number">
            <strong><Counter :to="number.to" :decimals="number.decimals" :suffix="number.suffix" /></strong>
            <span>{{ copy.monitor.numbers[index] }}</span>
          </div>
        </div>
        <p class="numbers-note">{{ copy.monitor.note }}</p>

        <div class="promises l-reveal">
          <div v-for="(promise, index) in copy.monitor.promises" :key="index" class="promise">
            <span class="n">{{ String(index + 1).padStart(2, '0') }}</span>
            <h3>{{ promise.title }}</h3>
            <p>{{ promise.text }}</p>
          </div>
        </div>

        <AskClaude class="ask l-reveal" />

        <a class="l-btn primary l-reveal" :href="withBase('/book/40-monitor')">{{ copy.monitor.cta }} <span class="arrow">→</span></a>
      </div>
    </section>

    <section id="agents" class="l-section">
      <div class="l-container">
        <AgentTerminal class="l-reveal" />
      </div>
    </section>

    <section id="rest" class="l-section">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow"><b>07</b> {{ copy.rest.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.rest.title }} <span class="l-ink">{{ copy.rest.rest }}</span></h2>
        </header>
        <Bento class="l-reveal" />
      </div>
    </section>

    <section id="cooper" class="l-section">
      <div class="l-container two">
        <div class="l-reveal">
          <p class="l-eyebrow"><b>08</b> {{ copy.cooper.eyebrow }}</p>
          <h2 class="l-h2">{{ copy.cooper.title }}</h2>
          <p class="l-lead">{{ copy.cooper.lead }}</p>
          <a class="l-btn ghost go" :href="withBase('/book/02-meet-cooper')">{{ copy.cooper.go }} <span class="arrow">→</span></a>
        </div>
        <div class="pair l-reveal" style="--i: 1">
          <Shot class="shot-frame" name="cooper-board" :alt="copy.cooper.board" />
          <Shot class="shot-frame" name="cooper-backoffice" :alt="copy.cooper.backoffice" />
        </div>
      </div>
    </section>

    <section class="l-section end">
      <div class="l-container l-reveal">
        <h2 class="l-h2">{{ copy.end.title }}</h2>
        <p class="l-lead">{{ copy.end.lead }}</p>
        <div class="end-actions">
          <a class="l-btn primary" :href="withBase('/book/00-how-to-read')">{{ copy.end.read }} <span class="arrow">→</span></a>
          <a class="l-btn ghost" :href="withBase('/book/40-monitor')">{{ copy.end.monitor }}</a>
        </div>
        <p v-if="copy.end.note" class="end-note">{{ copy.end.note }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tint { background: var(--l-bg-2); }
.two { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: clamp(32px, 6vw, 80px); align-items: center; }

.versus { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; margin-bottom: clamp(56px, 8vw, 96px); }
.tag { margin-bottom: 12px; font-family: var(--vp-font-family-mono); font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--l-ink-3); }
.tag.good { color: var(--l-green-ink); }
.log-window { display: flex; flex-direction: column; gap: 8px; overflow: hidden; padding: 16px 18px; border-radius: 4px; background: var(--l-code-bg); border: 1px solid var(--l-code-border); }
.log-window code { font-size: 12px; color: var(--l-code-dim); white-space: nowrap; }
.insights { display: grid; border: 1px solid var(--l-border); border-radius: 4px; background: var(--l-panel); }
.insight { padding: 16px 18px; }
.insight + .insight { border-top: 1px solid var(--l-border); }
.insight-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.insight-head code { font-size: 13px; font-weight: 600; color: var(--l-ink); overflow-wrap: anywhere; }
.insight p { margin-top: 6px; font-size: 14.5px; line-height: 1.55; color: var(--l-ink-2); }

.numbers { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: clamp(56px, 8vw, 96px); border-top: 1px solid var(--l-border); border-bottom: 1px solid var(--l-border); }
.number { padding: 28px 16px; text-align: center; }
.number + .number { border-left: 1px solid var(--l-border); }
.number strong { display: block; font-size: clamp(28px, 3.4vw, 40px); font-weight: 600; letter-spacing: -0.03em; line-height: 1; color: var(--l-ink); }
.number > span { display: block; margin-top: 10px; font-size: 13px; color: var(--l-ink-3); }
.numbers-note { margin-top: 12px; text-align: center; font-size: 12.5px; color: var(--l-ink-3); }

.promises { display: grid; grid-template-columns: repeat(3, 1fr); margin: clamp(56px, 8vw, 96px) 0; border-top: 1px solid var(--l-border); }
.promise { padding: 28px 28px 0 0; }
.promise + .promise { padding-left: 28px; border-left: 1px solid var(--l-border); }
.promise .n { font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--l-orange); }
.promise h3 { margin-top: 10px; font-size: 17px; font-weight: 650; color: var(--l-ink); }
.promise p { margin-top: 8px; font-size: 14.5px; line-height: 1.65; color: var(--l-ink-2); }
.ask { margin-bottom: clamp(48px, 7vw, 80px); }

.go { margin-top: 32px; }
.pair { display: grid; }
.pair :deep(.shot-frame) { border-radius: 4px; overflow: hidden; border: 1px solid var(--l-border-strong); background: var(--l-panel); }
.pair :deep(.shot-frame:last-child) { width: 72%; margin: -16% 0 0 auto; box-shadow: var(--l-shadow-big); }

.end .l-container { max-width: 760px; text-align: center; }
.end .l-lead { margin-left: auto; margin-right: auto; }
.end-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 32px; }
.end-note { margin-top: 16px; font-size: 13px; color: var(--l-ink-3); }

@media (max-width: 1000px) {
  .two, .versus { grid-template-columns: minmax(0, 1fr); }
  .numbers { grid-template-columns: 1fr 1fr; }
  .number:nth-child(3) { border-left: 0; }
  .number:nth-child(n + 3) { border-top: 1px solid var(--l-border); }
  .promises { grid-template-columns: minmax(0, 1fr); }
  .promise, .promise + .promise { padding: 24px 0; border-left: 0; }
  .promise + .promise { border-top: 1px solid var(--l-border); }
}
</style>
