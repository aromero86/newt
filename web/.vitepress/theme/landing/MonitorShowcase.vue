<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import Shot from './Shot.vue'
import { useCopy } from './i18n'
import { onInView, reducedMotion } from './motion'

/**
 * What newt-monitor shows of an application, one screen each, with what to look at on it: each hotspot is where
 * it is on the screenshot, in percent of its width and height. `ratio` is the screenshot's height over its width.
 */
const english = [
  {
    key: 'overview', label: 'Overview', shot: 'monitor-overview', ratio: 0.625, path: 'cooper',
    title: 'The whole application, at a glance',
    text: 'What it is made of, read from its code. Its instances, disk, memory and event loop. Every use case\'s calls, errors, failures and times, from the last hour to the last year, with every deploy marked.',
    link: '/manual/43-metrics',
    spots: [
      { x: 53, y: 29, label: '150 use cases, read from the code' },
      { x: 61, y: 60, label: '0 failures nobody expected' },
      { x: 65.5, y: 76, label: 'A deploy, marked on every chart' },
    ],
  },
  {
    key: 'structure', label: 'Structure', shot: 'monitor-graph', ratio: 0.903, path: 'cooper/contexts/boards/card',
    title: 'What uses what, drawn from the code',
    text: 'Each module with what it uses and what uses it, across contexts. Every use case says whether it writes only to its own module, and whether it runs again on a conflict.',
    link: '/manual/42-structure',
    spots: [
      { x: 50.5, y: 26.8, label: 'card, and its dependencies' },
      { x: 32.5, y: 39.9, label: 'auth: another context' },
      { x: 68.5, y: 36.5, label: 'backoffice listens to it' },
      { x: 45, y: 51.4, label: 'Writes only to its own module' },
    ],
  },
  {
    key: 'use-case', label: 'Use cases', shot: 'monitor-use-case', ratio: 0.903, path: 'cooper/use-cases/card.create',
    title: 'Every use case, measured',
    text: 'Calls, errors by code, failures nobody expected, conflicts that ran it again, p50 to p99, beside the window before. Errors it says may happen are told apart from the ones that should not.',
    link: '/manual/43-metrics',
    spots: [
      { x: 53, y: 31.5, label: '675 errors it says may happen' },
      { x: 74, y: 31.5, label: '0 failures' },
      { x: 68.5, y: 40.5, label: 'p99, beside the hour before' },
      { x: 36.8, y: 51.2, label: 'Since the deploy' },
    ],
  },
  {
    key: 'traces', label: 'Traces', shot: 'monitor-trace', ratio: 0.903, path: 'cooper/traces/01a1…',
    title: 'One request, down to the last query',
    text: 'The use cases it called, in its context and in others, every query with its criteria and rows, the transaction, the event told, and the workers that ran after it.',
    link: '/manual/44-traces',
    spots: [
      { x: 81, y: 27.6, label: '4 ms, the whole request' },
      { x: 17, y: 45.3, label: 'auth, called by its use case' },
      { x: 14, y: 75.8, label: 'One transaction' },
      { x: 16, y: 91, label: 'card.created, told after commit' },
      { x: 72, y: 93.6, label: 'Its workers, after the answer' },
    ],
  },
  {
    key: 'queues', label: 'Queues', shot: 'monitor-queues', ratio: 0.903, path: 'cooper/queues',
    title: 'The outbox, live',
    text: 'Every queue: what waits, what runs, how long jobs wait, what died. A queue nobody serves after a deploy is flagged. The depth over time tells you a worker fell behind before your users do.',
    link: '/manual/45-queues',
    spots: [
      { x: 52, y: 17.3, label: 'One job ran out of attempts' },
      { x: 85, y: 45.5, label: 'How long jobs waited' },
      { x: 30, y: 73.6, label: 'Every queue, named by what it runs' },
    ],
  },
  {
    key: 'dead', label: 'Dead jobs', shot: 'monitor-job', ratio: 0.903, path: 'cooper/queues/boards/card.notifyAssignee…',
    title: 'What died, and why',
    text: 'A job that failed every attempt keeps its event and its last error. Read why, fix the cause, and let your application put it back: in cooper, the backoffice does it with one button.',
    link: '/manual/45-queues',
    spots: [
      { x: 52, y: 25, label: 'Dead now' },
      { x: 56, y: 78.7, label: 'Its last error' },
      { x: 89, y: 77.8, label: '5 attempts' },
    ],
  },
  {
    key: 'system', label: 'System', shot: 'monitor-system', ratio: 0.903, path: 'cooper/system',
    title: 'Its instances, and their machines',
    text: 'CPU, memory, event loop delay and disk of every instance, and how many were alive, minute by minute, across deploys.',
    link: '/manual/43-metrics',
    spots: [],
  },
]
const screens = useCopy(english, [
  {
    label: 'Resumen', title: 'Toda la aplicación, de un vistazo',
    text: 'De qué está hecha, leído de su código. Sus instancias, disco, memoria y event loop. Las llamadas, errores, fallos y tiempos de cada caso de uso, de la última hora al último año, con cada despliegue marcado.',
    spots: [{ label: '150 casos de uso, leídos del código' }, { label: '0 fallos que nadie esperaba' }, { label: 'Un despliegue, marcado en cada gráfica' }],
  },
  {
    label: 'Estructura', title: 'Qué usa qué, dibujado desde el código',
    text: 'Cada módulo con lo que usa y lo que lo usa, entre contextos. Cada caso de uso dice si escribe solo en su módulo, y si vuelve a ejecutarse ante un conflicto.',
    spots: [{ label: 'card, y sus dependencias' }, { label: 'auth: otro contexto' }, { label: 'backoffice lo escucha' }, { label: 'Escribe solo en su módulo' }],
  },
  {
    label: 'Casos de uso', title: 'Cada caso de uso, medido',
    text: 'Llamadas, errores por código, fallos que nadie esperaba, conflictos que lo repitieron, de p50 a p99, junto a la ventana anterior. Los errores que dice que pueden pasar se separan de los que no deberían.',
    spots: [{ label: '675 errores que dice que pueden pasar' }, { label: '0 fallos' }, { label: 'p99, junto a la hora anterior' }, { label: 'Desde el despliegue' }],
  },
  {
    label: 'Trazas', title: 'Una petición, hasta la última consulta',
    text: 'Los casos de uso a los que llamó, en su contexto y en otros, cada consulta con sus criterios y filas, la transacción, el evento contado y los workers que vinieron después.',
    spots: [{ label: '4 ms, la petición entera' }, { label: 'auth, llamado por su caso de uso' }, { label: 'Una transacción' }, { label: 'card.created, contado tras el commit' }, { label: 'Sus workers, tras la respuesta' }],
  },
  {
    label: 'Colas', title: 'El outbox, en directo',
    text: 'Cada cola: lo que espera, lo que corre, cuánto esperan los jobs, lo que murió. Una cola que nadie atiende tras un despliegue queda marcada. La profundidad en el tiempo te dice que un worker se quedó atrás antes que tus usuarios.',
    spots: [{ label: 'Un job agotó sus intentos' }, { label: 'Cuánto esperaron los jobs' }, { label: 'Cada cola, con el nombre de lo que ejecuta' }],
  },
  {
    label: 'Jobs muertos', title: 'Qué murió, y por qué',
    text: 'Un job que falló todos sus intentos guarda su evento y su último error. Lee por qué, arregla la causa y deja que tu aplicación lo vuelva a poner: en cooper, el backoffice lo hace con un botón.',
    spots: [{ label: 'Muerto ahora' }, { label: 'Su último error' }, { label: '5 intentos' }],
  },
  {
    label: 'Sistema', title: 'Sus instancias, y sus máquinas',
    text: 'CPU, memoria, retraso del event loop y disco de cada instancia, y cuántas estaban vivas, minuto a minuto, entre despliegues.',
  },
])
const ui = useCopy({ aria: 'What newt-monitor shows', manual: 'In the manual →' }, { aria: 'Lo que enseña newt-monitor', manual: 'En el manual →' })

/** Each screen shows this long, and its screenshot scrolls in the frame's 16:10. */
const DWELL = 8
const FRAME = 0.625

const current = ref(0)
const cycle = ref(0)
const playing = ref(false)
const screen = computed(() => screens.value[current.value]!)

/** When each hotspot shows: once the scrolling screenshot brings it into the frame, and one after the other. */
const spots = computed(() => {
  const { ratio, spots } = screen.value
  const pan = Math.max(0, ratio - FRAME)
  return spots.map((spot, index) => {
    const needed = pan ? Math.max(0, (spot.y / 100 * ratio - FRAME + 0.06) / pan) : 0
    const at = needed > 0 ? DWELL * (0.3 + 0.55 * Math.min(1, needed)) : 0.6 + index * 0.6
    return { ...spot, delay: `${Math.max(at, 0.6 + index * 0.6).toFixed(2)}s`, left: spot.x > 62 }
  })
})
const pan = computed(() => `${(-Math.max(0, screen.value.ratio - FRAME) / screen.value.ratio * 100).toFixed(2)}%`)

function pick(index: number) { current.value = index; cycle.value++ }
function next() { if (!reducedMotion()) pick((current.value + 1) % screens.value.length) }

const root = ref<HTMLElement>()
onInView(root, () => { playing.value = true }, { threshold: 0.3, leave: () => { playing.value = false } })

</script>

<template>
  <div ref="root" class="showcase" :data-playing="playing" :style="{ '--dwell': `${DWELL}s` }">
    <div class="tabs" role="tablist" :aria-label="ui.aria">
      <div v-for="(each, index) in screens" :key="each.key" role="tab" tabindex="0" @keydown.enter="pick(index)" :aria-selected="index === current" :class="{ on: index === current }" @click="pick(index)">
        <span class="tab-label">{{ each.label }}</span>
        <span class="tab-body">
          <strong>{{ each.title }}</strong>
          <span>{{ each.text }}</span>
          <a :href="withBase(each.link)" @click.stop>{{ ui.manual }}</a>
        </span>
        <span class="progress"><i v-if="index === current" :key="cycle" @animationend="next" /></span>
      </div>
    </div>

    <div class="stage">
      <div class="browser">
        <div class="bar">
          <span class="url">monitor.your-company.dev/apps/{{ screen.path }}</span>
        </div>
        <div class="frame">
          <div :key="`${current}-${cycle}`" class="pan" :style="{ '--pan': pan }">
            <Shot :name="screen.shot" :alt="screen.title" />
            <span v-for="spot in spots" :key="spot.label" class="spot" :class="{ left: spot.left }" :style="{ left: `${spot.x}%`, top: `${spot.y}%`, animationDelay: spot.delay }">
              <i /><em>{{ spot.label }}</em>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.showcase { display: grid; grid-template-columns: minmax(0, .62fr) minmax(0, 1.38fr); gap: clamp(24px, 4vw, 48px); align-items: center; }

.tabs { display: grid; gap: 4px; }
.tabs > [role=tab] { cursor: pointer; outline-offset: 2px; position: relative; display: block; width: 100%; text-align: left; padding: 14px 18px 16px; border-radius: 4px; border: 1px solid transparent; transition: background .3s ease, border-color .3s ease; }
.tabs > [role=tab]:hover { background: var(--l-panel); }
.tabs > [role=tab].on { background: var(--l-panel); border-color: var(--l-border); box-shadow: var(--l-shadow); }
.tab-label { display: block; font-size: 15px; font-weight: 600; color: var(--l-ink-3); transition: color .3s ease; }
.on .tab-label { color: var(--l-ink); }
.tab-body { display: flex; flex-direction: column; overflow: hidden; max-height: 0; transition: max-height .6s ease; }
.on .tab-body { max-height: 260px; }
.tab-body strong { margin-top: 8px; font-size: 17px; font-weight: 650; line-height: 1.25; color: var(--l-ink); letter-spacing: -0.01em; }
.tab-body span { margin-top: 6px; font-size: 14.5px; line-height: 1.55; color: var(--l-ink-2); }
.tab-body a { margin-top: 8px; font-size: 13.5px; font-weight: 650; color: var(--l-green-ink); }
.progress { position: absolute; left: 18px; right: 18px; bottom: 6px; height: 2px; border-radius: 2px; background: transparent; overflow: hidden; }
.on .progress { background: var(--l-border); }
.progress i { display: block; height: 100%; width: 100%; transform-origin: 0 50%; transform: scaleX(0); background: var(--l-orange); animation: progress var(--dwell) linear forwards; animation-play-state: paused; }
.showcase[data-playing="true"] .progress i { animation-play-state: running; }
.showcase:has(.stage:hover) .progress i { animation-play-state: paused; }
@keyframes progress { to { transform: scaleX(1); } }

.stage { position: relative; }
.browser { border-radius: 4px; overflow: hidden; background: var(--l-code-bg); border: 1px solid var(--l-border-strong); box-shadow: var(--l-shadow-big); }
.bar { display: flex; align-items: center; gap: 16px; height: 36px; padding: 0 14px; background: var(--l-code-bar); border-bottom: 1px solid color-mix(in srgb, var(--l-code-ink) 6%, transparent); }
.url { flex: 1; min-width: 0; display: flex; align-items: center; color: var(--l-code-dim); font-size: 12px; font-family: var(--vp-font-family-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frame { position: relative; aspect-ratio: 16 / 10; overflow: hidden; }
/* The fade in always runs: paused, a screen just picked would stay hidden. */
.pan { position: relative; animation: pan var(--dwell) ease-in-out both, enter .6s ease both; animation-play-state: paused, running; }
.showcase[data-playing="true"] .pan { animation-play-state: running; }
.stage:hover .pan { animation-play-state: paused, running; }
.stage:hover .spot { animation-play-state: paused; }
@keyframes pan { 0%, 30% { transform: translateY(0); } 85%, 100% { transform: translateY(var(--pan)); } }
@keyframes enter { from { opacity: 0; } }

.spot { position: absolute; z-index: 1; width: 0; height: 0; opacity: 0; animation: spot .4s ease both; animation-play-state: paused; }
.showcase[data-playing="true"] .spot { animation-play-state: running; }
@keyframes spot { from { opacity: 0; transform: translateY(4px); } }
.spot i { position: absolute; left: -7px; top: -7px; width: 12px; height: 12px; border-radius: 50%; background: var(--l-orange); border: 2px solid var(--l-bg); }
.spot em { position: absolute; left: 16px; top: -15px; padding: 5px 10px; border-radius: 2px; font-style: normal; font-size: 12.5px; font-weight: 600; white-space: nowrap; color: var(--l-bg); background: var(--l-ink); border-left: 3px solid var(--l-orange); }
.spot.left em { left: auto; right: 16px; }

@media (max-width: 1000px) {
  .showcase { grid-template-columns: minmax(0, 1fr); }
  .tabs { order: 2; }
  .stage { order: 1; }
}
@media (max-width: 640px) {
  .spot em { display: none; }
  .url { font-size: 10.5px; }
}
</style>
