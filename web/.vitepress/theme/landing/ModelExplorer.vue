<script setup lang="ts">
import { ref } from 'vue'
import { withBase } from 'vitepress'
import ContextMap from './ContextMap.vue'
import { useCopy } from './i18n'
import { onInView, reducedMotion } from './motion'

/** newt's model, from the application down to how two modules talk: one step at a time, cooper as the example. */
const english = [
  {
    key: 'application', label: 'The application', title: 'Bounded contexts, each with its own database',
    text: 'An application is bounded contexts. Each owns a store of its own and a set of modules, and says which other contexts it uses. cooper has three.',
    rules: ['A context reaches only the contexts it says it uses', 'Never in a cycle', 'Another context\'s tables are never read'],
    link: '/book/03-contexts',
  },
  {
    key: 'context', label: 'A context', title: 'Modules, each owning one entity',
    text: 'A context is modules: boards has board, column, card, member, activity and workspace. Each module declares, in its Deps, what it uses; the application knows it, and newt-monitor draws it.',
    rules: ['One module, one entity, one responsibility', 'It names what it uses, typed', 'It points at another\'s things only by id'],
    link: '/book/04-modules',
  },
  {
    key: 'module', label: 'A module', title: 'The same anatomy, every time',
    text: 'Every module has the same files, so you, and your coding agent, always know where a thing goes. The lint refuses any other file.',
    rules: ['Only the repository touches the store', 'Only the entity changes itself', 'A route calls one use case'],
    link: '/book/04-modules',
  },
  {
    key: 'talk', label: 'Between modules', title: 'They ask, and they hear',
    text: 'A module asks another in the request, through its use cases, to read. It hears another after the commit: a worker runs one of its own use cases on the event, in a transaction of its own. Writing into another module from a request is refused when it runs.',
    rules: ['Asks: reads, in the request, by use cases', 'Hears: writes, after the commit, from a worker', 'Across contexts, the very same'],
    link: '/book/11-between-contexts',
  },
]
const steps = useCopy(english, [
  {
    label: 'La aplicación', title: 'Contextos delimitados, cada uno con su base de datos',
    text: 'Una aplicación son contextos delimitados. Cada uno tiene su propio almacén y sus módulos, y dice qué otros contextos usa. cooper tiene tres.',
    rules: ['Un contexto solo llega a los contextos que dice usar', 'Nunca en ciclo', 'Las tablas de otro contexto no se leen jamás'],
  },
  {
    label: 'Un contexto', title: 'Módulos, cada uno dueño de una entidad',
    text: 'Un contexto son módulos: boards tiene board, column, card, member, activity y workspace. Cada módulo declara en sus Deps lo que usa; la aplicación lo sabe, y newt-monitor lo dibuja.',
    rules: ['Un módulo, una entidad, una responsabilidad', 'Nombra lo que usa, con tipos', 'Apunta a lo de otro solo por id'],
  },
  {
    label: 'Un módulo', title: 'La misma anatomía, siempre',
    text: 'Todos los módulos tienen los mismos ficheros, así que tú, y tu agente de código, siempre sabéis dónde va cada cosa. El lint rechaza cualquier otro fichero.',
    rules: ['Solo el repositorio toca el almacén', 'Solo la entidad se cambia a sí misma', 'Una ruta llama a un caso de uso'],
  },
  {
    label: 'Entre módulos', title: 'Preguntan, y escuchan',
    text: 'Un módulo pregunta a otro durante la petición, por sus casos de uso, para leer. Escucha a otro después del commit: un worker ejecuta uno de sus propios casos de uso con el evento, en su propia transacción. Escribir en otro módulo desde una petición se rechaza al ejecutarse.',
    rules: ['Pregunta: lee, en la petición, por casos de uso', 'Escucha: escribe, tras el commit, desde un worker', 'Entre contextos, exactamente igual'],
  },
])
const ui = useCopy({
  aria: 'newt\'s model, step by step', book: 'In the book →',
  graph: 'its modules, and how they depend on each other', graphAria: 'boards\' modules and their dependencies',
  legendAsks: 'asks: calls its use cases, in the request', legendHears: 'hears: its events, from a worker',
  request: 'In the request', requestWhat: 'asks, to read', after: 'After the commit', afterWhat: 'hears, to write',
  commit: 'the card, and card.created in the outbox',
  files: [
    'Zod schemas, the DTO, inputs and filters: the module\'s public contract.',
    'The entity: changes itself with methods named after what happened, and tracks its events.',
    'Its use cases: validate, load, ask who may, let the entity change, save once.',
    'The only file that touches the store. It says its scope: a workspace.',
    'HTTP: read the request as it came, call one use case, answer.',
    'Its reactions: to its own events, to others\', to schedules.',
    'What it uses: board, column, member, and auth\'s access.',
    'One class per file: card.created, card.edited…; card.not_found…',
  ],
}, {
  aria: 'El modelo de newt, paso a paso', book: 'En el libro →',
  graph: 'sus módulos, y cómo dependen unos de otros', graphAria: 'Los módulos de boards y sus dependencias',
  legendAsks: 'pregunta: llama a sus casos de uso, en la petición', legendHears: 'escucha: sus eventos, desde un worker',
  request: 'En la petición', requestWhat: 'pregunta, para leer', after: 'Tras el commit', afterWhat: 'escucha, para escribir',
  commit: 'la tarjeta, y card.created en el outbox',
  files: [
    'Esquemas Zod, el DTO, entradas y filtros: el contrato público del módulo.',
    'La entidad: se cambia con métodos que llevan el nombre de lo que pasó, y registra sus eventos.',
    'Sus casos de uso: validar, cargar, preguntar quién puede, dejar que la entidad cambie, guardar una vez.',
    'El único fichero que toca el almacén. Dice su ámbito: un espacio de trabajo.',
    'HTTP: leer la petición tal como llega, llamar a un caso de uso, responder.',
    'Sus reacciones: a sus propios eventos, a los de otros, a horarios.',
    'Lo que usa: board, column, member, y access de auth.',
    'Una clase por fichero: card.created, card.edited…; card.not_found…',
  ],
})
const DWELL = 11

const current = ref(0)
const cycle = ref(0)
const playing = ref(false)
function pick(index: number) { current.value = index; cycle.value++ }
function next() { if (!reducedMotion()) pick((current.value + 1) % steps.value.length) }
const root = ref<HTMLElement>()
onInView(root, () => { playing.value = true }, { threshold: 0.3, leave: () => { playing.value = false } })

/** boards' modules and what each uses, as their Deps say (workspace left out, for room). */
const nodes = [
  { name: 'member', x: 234, y: 18 },
  { name: 'board', x: 44, y: 138 },
  { name: 'column', x: 234, y: 138 },
  { name: 'activity', x: 424, y: 138 },
  { name: 'card', x: 234, y: 258 },
]
const asks = [
  { d: 'M150,138 L262,64', label: '' },
  { d: 'M300,138 L300,66', label: 'isMember' },
  { d: 'M234,161 L178,161', label: '' },
  { d: 'M262,258 L150,186', label: 'board.get' },
  { d: 'M300,258 L300,186', label: 'column.list' },
  { d: 'M452,138 L340,64', label: '' },
  { d: 'M366,41 L430,41', label: '' },
]
const hears = [
  { d: 'M490,186 C490,250 430,281 368,281', label: 'card.created, card.edited…', lx: 384, ly: 306 },
]

/** card's files, and what each holds. */
const files = [
  { name: 'card.schema.ts', role: 'contract' },
  { name: 'card.ts', role: 'domain' },
  { name: 'card.module.ts', role: 'domain' },
  { name: 'card.repository.ts', role: 'store' },
  { name: 'card.routes.ts', role: 'edge' },
  { name: 'card.workers.ts', role: 'edge' },
  { name: 'card.deps.ts', role: 'contract' },
  { name: 'events/ · errors/', role: 'contract' },
]
</script>

<template>
  <div ref="root" class="model" :data-playing="playing" :style="{ '--dwell': `${DWELL}s` }">
    <ol class="steps" role="tablist" :aria-label="ui.aria">
      <li v-for="(step, index) in steps" :key="step.key" role="tab" tabindex="0" :aria-selected="index === current" :class="{ on: index === current, done: index < current }"
          @click="pick(index)" @keydown.enter="pick(index)">
        <span class="n">{{ index + 1 }}</span>
        <div class="body">
          <span class="label">{{ step.label }}</span>
          <div class="more">
            <strong>{{ step.title }}</strong>
            <p>{{ step.text }}</p>
            <ul><li v-for="rule in step.rules" :key="rule">{{ rule }}</li></ul>
            <a :href="withBase(step.link)" @click.stop>{{ ui.book }}</a>
          </div>
        </div>
        <span class="bar"><i v-if="index === current" :key="cycle" @animationend="next" /></span>
      </li>
    </ol>

    <div class="stage">
      <Transition name="scene" mode="out-in">
        <ContextMap v-if="current === 0" key="application" />

        <div v-else-if="current === 1" key="context" class="scene graph">
          <p class="scene-title"><span class="ctx boards">boards</span> {{ ui.graph }}</p>
          <svg viewBox="0 0 620 320" role="img" :aria-label="ui.graphAria">
            <defs>
              <marker id="ask-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="ask-head" /></marker>
              <marker id="hear-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" class="hear-head" /></marker>
            </defs>
            <g v-for="(edge, index) in asks" :key="edge.d" class="ask" :style="{ '--i': index }">
              <path :d="edge.d" marker-end="url(#ask-head)" pathLength="100" />
            </g>
            <g v-for="(edge, index) in hears" :key="edge.d" class="hear" :style="{ '--i': index + 7 }">
              <path :d="edge.d" marker-end="url(#hear-head)" />
              <circle r="3.5"><animateMotion :path="edge.d" dur="2.6s" repeatCount="indefinite" /></circle>
              <text :x="edge.lx" :y="edge.ly">{{ edge.label }}</text>
            </g>
            <g v-for="(node, index) in nodes" :key="node.name" class="node" :class="{ star: node.name === 'card' }" :style="{ '--i': index }">
              <rect :x="node.x" :y="node.y" width="132" height="46" rx="4" />
              <text :x="node.x + 66" :y="node.y + 28">{{ node.name }}</text>
            </g>
            <g class="node other" :style="{ '--i': 5 }">
              <rect x="430" y="18" width="150" height="46" rx="4" />
              <text x="505" y="38" class="ctx-name">auth</text>
              <text x="505" y="54" class="small">access · tenant · user</text>
            </g>
          </svg>
          <p class="legend"><span class="solid" /> {{ ui.legendAsks }} <span class="dashed" /> {{ ui.legendHears }}</p>
        </div>

        <div v-else-if="current === 2" key="module" class="scene anatomy">
          <p class="scene-title"><code>boards/modules/card/</code></p>
          <div class="flow">
            <span>route</span><i>→</i><span>use case</span><i>→</i><span class="g">entity</span><i>→</i><span class="b">repository</span><i>→</i><span class="b">store</span>
            <i class="sep" /><span class="o">events</span><i>→</i><span class="o">workers</span>
          </div>
          <div class="files">
            <div v-for="(file, index) in files" :key="file.name" class="file" :class="file.role" :style="{ '--i': index }">
              <code>{{ file.name }}</code>
              <p>{{ ui.files[index] }}</p>
            </div>
          </div>
        </div>

        <div v-else key="talk" class="scene talk">
          <div class="lane asks">
            <p class="lane-head"><b>{{ ui.request }}</b> {{ ui.requestWhat }}</p>
            <div class="track">
              <span class="chip req">POST /cards</span><i class="arrow" />
              <span class="chip uc">card.create</span><i class="arrow" />
              <div class="fanout">
                <span class="chip">board.get</span>
                <span class="chip">column.list</span>
                <span class="chip">member.enter <em>→</em> <span class="ctx auth">auth</span> access.check</span>
              </div>
            </div>
            <span class="pulse" />
          </div>
          <div class="commit"><span>COMMIT</span> {{ ui.commit }}</div>
          <div class="lane hears">
            <p class="lane-head"><b>{{ ui.after }}</b> {{ ui.afterWhat }}</p>
            <div class="track">
              <span class="chip ev">◇ card.created</span><i class="arrow" />
              <div class="fanout">
                <span class="chip">activity.recordCreated <span class="ctx boards">boards</span></span>
                <span class="chip">card.indexCard <span class="ctx boards">boards</span></span>
                <span class="chip">metric.recordCard <span class="ctx backoffice">backoffice</span></span>
              </div>
            </div>
            <span class="pulse" />
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.model { display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: clamp(28px, 5vw, 64px); align-items: start; }

.steps { list-style: none; display: grid; gap: 6px; }
.steps > li { position: relative; display: flex; gap: 14px; padding: 14px 16px 18px; border-radius: 4px; border: 1px solid transparent; cursor: pointer; transition: background .3s ease, border-color .3s ease; }
.steps > li:hover { background: var(--l-panel); }
.steps > li.on { background: var(--l-panel); border-color: var(--l-border); box-shadow: var(--l-shadow); }
.n { flex: none; width: 26px; height: 26px; border-radius: 2px; display: grid; place-items: center; font-family: var(--vp-font-family-mono); font-size: 13px; font-weight: 800; color: var(--l-ink-3); border: 1px solid var(--l-border-strong); transition: all .3s ease; }
.on .n { color: var(--l-on-accent); background: var(--l-orange); border-color: var(--l-orange); }
.done .n { color: var(--l-on-accent); background: var(--l-green); border-color: var(--l-green); }
.body { min-width: 0; }
.label { display: block; padding-top: 2px; font-size: 15.5px; font-weight: 600; color: var(--l-ink-3); }
.on .label { color: var(--l-ink); }
.more { max-height: 0; overflow: hidden; transition: max-height .6s ease; }
.on .more { max-height: 420px; }
.more strong { display: block; margin-top: 8px; font-size: 18px; font-weight: 650; line-height: 1.25; color: var(--l-ink); }
.more p { margin-top: 8px; font-size: 14.5px; line-height: 1.6; color: var(--l-ink-2); }
.more ul { list-style: none; display: grid; gap: 6px; margin-top: 12px; }
.more ul li { position: relative; padding-left: 20px; font-size: 13.5px; color: var(--l-ink-2); }
.more ul li::before { content: '›'; position: absolute; left: 4px; color: var(--l-orange); font-weight: 800; }
.more a { display: inline-block; margin-top: 12px; font-size: 13.5px; font-weight: 650; color: var(--l-green-ink); }
.bar { position: absolute; left: 16px; right: 16px; bottom: 6px; height: 2px; overflow: hidden; }
.on .bar { background: var(--l-border); }
.bar i { display: block; height: 100%; transform-origin: 0 50%; transform: scaleX(0); background: var(--l-orange); animation: fill var(--dwell) linear forwards; animation-play-state: paused; }
.model[data-playing="true"] .bar i { animation-play-state: running; }
.model:hover .bar i { animation-play-state: paused; }
@keyframes fill { to { transform: scaleX(1); } }

.stage { min-height: 520px; }
.scene { padding: 20px; border-radius: 4px; background: var(--l-panel); border: 1px solid var(--l-border); box-shadow: var(--l-shadow); }
.scene-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 650; color: var(--l-ink-2); margin-bottom: 12px; }
.scene-title code { font-size: 13px; color: var(--l-orange); }
.scene-enter-active, .scene-leave-active { transition: opacity .35s ease, transform .35s ease; }
.scene-enter-from { opacity: 0; transform: translateX(16px); }
.scene-leave-to { opacity: 0; transform: translateX(-16px); }

/* boards' graph */
.graph svg { display: block; width: 100%; height: auto; overflow: visible; }
.node rect { fill: var(--l-panel-solid); stroke: var(--l-border-strong); stroke-width: 1.2; }
.node text { font-family: var(--vp-font-family-mono); font-size: 13.5px; font-weight: 700; fill: var(--l-ink); text-anchor: middle; }
.node.star rect { stroke: var(--l-orange); stroke-width: 2; fill: color-mix(in srgb, var(--l-orange) 10%, var(--l-panel-solid)); }
.node.other rect { stroke: var(--l-violet); stroke-dasharray: 5 4; fill: color-mix(in srgb, var(--l-violet) 8%, transparent); }
.node.other .ctx-name { fill: var(--l-violet); font-size: 13px; }
.node.other .small { font-size: 10.5px; font-weight: 500; fill: var(--l-ink-3); }
.node { animation: pop .5s ease both; animation-delay: calc(var(--i) * 80ms); transform-box: fill-box; transform-origin: center; }
@keyframes pop { from { opacity: 0; } }
.ask path { fill: none; stroke: var(--l-blue); stroke-width: 1.8; stroke-dasharray: 100; stroke-dashoffset: 100; animation: draw .7s ease forwards; animation-delay: calc(.4s + var(--i) * 90ms); }
.ask-head { fill: var(--l-blue); }
@keyframes draw { to { stroke-dashoffset: 0; } }
.hear path { fill: none; stroke: var(--l-orange); stroke-width: 1.8; stroke-dasharray: 6 5; animation: march 1s linear infinite; }
.hear-head { fill: var(--l-orange); }
.hear circle { fill: var(--l-orange); }
.hear text { font-family: var(--vp-font-family-mono); font-size: 11px; fill: var(--l-orange); text-anchor: start; paint-order: stroke; stroke: var(--l-panel); stroke-width: 4px; }
@keyframes march { to { stroke-dashoffset: -11; } }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 10px; font-size: 13px; color: var(--l-ink-3); }
.legend span { width: 26px; height: 0; border-top: 2px solid var(--l-blue); }
.legend .dashed { margin-left: 12px; border-top: 2px dashed var(--l-orange); }

/* card's anatomy */
.flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 12px; margin-bottom: 14px; border-radius: 4px; background: var(--l-bg-2); border: 1px solid var(--l-border); }
.flow span { padding: 4px 9px; border-radius: 3px; font-family: var(--vp-font-family-mono); font-size: 12px; font-weight: 650; color: var(--l-ink-2); background: var(--l-panel-solid); border: 1px solid var(--l-border); }
.flow .g { color: var(--l-green-ink); border-color: var(--l-green); }
.flow .b { color: var(--l-blue); border-color: var(--l-blue); }
.flow .o { color: var(--l-orange); border-color: var(--l-orange); }
.flow i { font-style: normal; color: var(--l-ink-3); }
.flow .sep { width: 1px; height: 20px; margin: 0 6px; background: var(--l-border-strong); }
.files { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.file { padding: 12px 14px; border-radius: 4px; background: var(--l-panel-solid); border: 1px solid var(--l-border); border-left: 3px solid var(--c); animation: rise .45s ease both; animation-delay: calc(var(--i) * 70ms); }
.file.contract { --c: var(--l-yellow); }
.file.domain { --c: var(--l-green); }
.file.store { --c: var(--l-blue); }
.file.edge { --c: var(--l-orange); }
.file code { font-size: 12.5px; font-weight: 700; color: var(--l-ink); }
.file p { margin-top: 4px; font-size: 13px; line-height: 1.5; color: var(--l-ink-2); }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }

/* asks and hears */
.talk { display: grid; gap: 12px; }
.lane { position: relative; overflow: hidden; padding: 14px; border-radius: 4px; border: 1px solid var(--c); background: color-mix(in srgb, var(--c) 6%, var(--l-panel-solid)); animation: rise .45s ease both; }
.lane.asks { --c: var(--l-blue); }
.lane.hears { --c: var(--l-orange); animation-delay: .5s; }
.lane-head { font-size: 13px; color: var(--l-ink-3); margin-bottom: 10px; }
.lane-head b { margin-right: 8px; font-family: var(--vp-font-family-mono); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--c); }
.track { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 3px; font-family: var(--vp-font-family-mono); font-size: 12px; font-weight: 650; color: var(--l-ink); background: var(--l-panel-solid); border: 1px solid var(--l-border); white-space: nowrap; }
.chip em { font-style: normal; color: var(--l-ink-3); }
.chip.req { color: var(--l-green-ink); }
.chip.uc, .chip.ev { border-color: var(--c); color: var(--c); }
.arrow { width: 18px; height: 2px; background: var(--c); position: relative; }
.arrow::after { content: ''; position: absolute; right: -2px; top: -4px; border: 5px solid transparent; border-left-color: var(--c); border-right: 0; }
.fanout { display: grid; gap: 6px; padding-left: 10px; border-left: 2px solid var(--c); }
.pulse { position: absolute; left: 0; bottom: 0; height: 2px; width: 30%; background: linear-gradient(90deg, transparent, var(--c), transparent); animation: sweep 2.4s linear infinite; }
.hears .pulse { animation-delay: 1.2s; }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
.commit { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--l-ink-3); padding-left: 14px; }
.commit span { padding: 3px 8px; border-radius: 3px; font-family: var(--vp-font-family-mono); font-size: 11.5px; font-weight: 800; color: var(--l-on-accent); background: var(--l-green); }

@media (max-width: 1000px) {
  .model { grid-template-columns: minmax(0, 1fr); }
  .stage { min-height: 0; }
}
@media (max-width: 640px) {
  .files { grid-template-columns: minmax(0, 1fr); }
  .chip { white-space: normal; }
}
</style>
