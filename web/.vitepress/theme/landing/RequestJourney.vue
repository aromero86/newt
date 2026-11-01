<script setup lang="ts">
import { computed, ref } from 'vue'
import Shot from './Shot.vue'
import { useCopy } from './i18n'
import { onInView, reducedMotion } from './motion'

/**
 * One card created in cooper, as newt-monitor kept its trace: every step, when it started and how long it took,
 * in milliseconds. Replayed here at human speed.
 */
type Kind = 'http' | 'use' | 'query' | 'limit' | 'tx' | 'event' | 'worker'
const spans: { name: string, detail?: string, ctx?: string, kind: Kind, depth: number, start: number, duration: number }[] = [
  { name: 'POST /api/workspaces/:workspaceId/boards/:boardId/cards', kind: 'http', depth: 0, start: 0, duration: 4.1 },
  { name: 'session.authenticate', ctx: 'boards', kind: 'use', depth: 1, start: 0.04, duration: 0.07 },
  { name: 'session.find', detail: '{tokenHash} · 1 row', kind: 'query', depth: 2, start: 0.04, duration: 0.04 },
  { name: 'api', detail: '291 of 600 left', kind: 'limit', depth: 1, start: 0.08, duration: 0.07 },
  { name: 'idempotency_key.insert', kind: 'query', depth: 1, start: 0.24, duration: 0.09 },
  { name: 'member.enter', ctx: 'boards', kind: 'use', depth: 1, start: 0.34, duration: 0.11 },
  { name: 'access.check', ctx: 'auth', kind: 'use', depth: 2, start: 0.35, duration: 0.1 },
  { name: 'card.create', ctx: 'boards', kind: 'use', depth: 1, start: 0.46, duration: 0.95 },
  { name: 'board.get', ctx: 'boards', kind: 'use', depth: 2, start: 0.48, duration: 0.06 },
  { name: 'column.list', ctx: 'boards', kind: 'use', depth: 2, start: 0.54, duration: 0.06 },
  { name: 'transaction', detail: 'commit 0.13 ms', kind: 'tx', depth: 2, start: 0.69, duration: 0.41 },
  { name: 'card.insert', kind: 'query', depth: 3, start: 0.78, duration: 0.04 },
  { name: 'card.created', detail: 'told', kind: 'event', depth: 3, start: 0.95, duration: 0 },
  { name: 'card.indexCard.on.card.created', ctx: 'boards', kind: 'worker', depth: 4, start: 1.9, duration: 1.3 },
  { name: 'activity.recordCreated.on.card.created', ctx: 'boards', kind: 'worker', depth: 4, start: 1.9, duration: 3.2 },
  { name: 'metric.recordCard.on.card.created', ctx: 'backoffice', kind: 'worker', depth: 4, start: 1.9, duration: 2.8 },
  { name: 'card.leaveRemovedColumn.on.card.created', ctx: 'boards', kind: 'worker', depth: 4, start: 1.9, duration: 1.9 },
]
const END = 5.2
const WORKERS_FROM = 0.95

/** Where the replay pauses, and what it says there. */
const english = [
  { at: 0, span: 0, stage: 0, title: 'The route', text: 'The router takes the request. A route does not think: it reads the body as it came and calls one use case.' },
  { at: 0.04, span: 1, stage: 0, title: 'Who is asking', text: 'The session cookie, checked against a hash. Every route needs a session unless it says it is public.' },
  { at: 0.08, span: 3, stage: 0, title: 'A rate limit', text: 'This route\'s limit, counted per person: 291 of 600 left. Past it, a 429 with Retry-After.' },
  { at: 0.24, span: 4, stage: 0, title: 'Sent twice, done once', text: 'A POST that creates takes an Idempotency-Key. A second send gets the first answer.' },
  { at: 0.34, span: 6, stage: 1, title: 'May they?', text: 'boards asks auth, another context, through its use case access.check, then enters the workspace\'s scope.' },
  { at: 0.46, span: 7, stage: 1, title: 'The use case', text: 'card.create validates the input, loads the board and its column, and lets the entity create itself.' },
  { at: 0.69, span: 10, stage: 2, title: 'One save', text: 'One transaction: the card\'s number from a counter row, the card, and its event written to the outbox beside it.' },
  { at: 0.95, span: 12, stage: 3, title: 'Told, after the commit', text: 'Only now that it is committed is card.created told. Had the process died before, there would be no card and no event.' },
  { at: 1.9, span: 13, stage: 4, title: 'Four workers', text: 'Each reaction is a job: the search, the activity, a metric in another context, the column. Each runs until it succeeds, safe to run twice.' },
  { at: END, span: 15, stage: 4, title: '27 steps, 4 ms', text: 'The answer left in 4 ms; its reactions ran after, in their own transactions. newt-monitor keeps all of it, for every request it samples.' },
]
const beats = useCopy(english, [
  { title: 'La ruta', text: 'El router recibe la petición. Una ruta no piensa: lee el cuerpo tal como llega y llama a un caso de uso.' },
  { title: 'Quién pregunta', text: 'La cookie de sesión, comprobada contra un hash. Toda ruta necesita sesión salvo que diga que es pública.' },
  { title: 'Un rate limit', text: 'El límite de esta ruta, contado por persona: le quedan 291 de 600. Al pasarse, un 429 con Retry-After.' },
  { title: 'Enviada dos veces, hecha una', text: 'Un POST que crea lleva una Idempotency-Key. Un segundo envío recibe la primera respuesta.' },
  { title: '¿Puede?', text: 'boards pregunta a auth, otro contexto, por su caso de uso access.check, y entra en el ámbito del espacio de trabajo.' },
  { title: 'El caso de uso', text: 'card.create valida la entrada, carga el tablero y su columna, y deja que la entidad se cree a sí misma.' },
  { title: 'Un guardado', text: 'Una transacción: el número de la tarjeta desde una fila contador, la tarjeta, y su evento escrito en el outbox a su lado.' },
  { title: 'Contado, tras el commit', text: 'Solo ahora, con el commit hecho, se cuenta card.created. Si el proceso hubiera muerto antes, no habría ni tarjeta ni evento.' },
  { title: 'Cuatro workers', text: 'Cada reacción es un job: la búsqueda, la actividad, una métrica en otro contexto, la columna. Cada uno se ejecuta hasta que sale bien, y es seguro ejecutarlo dos veces.' },
  { title: '27 pasos, 4 ms', text: 'La respuesta salió en 4 ms; sus reacciones vinieron después, en sus propias transacciones. newt-monitor lo guarda todo, en cada petición que muestrea.' },
])
const ui = useCopy({
  stages: ['Route', 'Use case', 'Store', 'Outbox', 'Workers'],
  replay: 'Live replay', real: 'The real trace', again: '↻ Replay', step: 'Step', zoom: 'first millisecond, zoomed in',
  viewAria: 'Replay or the real screenshot', stagesAria: 'Where the request is', jumpAria: 'Jump to a step',
  shot: 'The same request in newt-monitor: every use case, query, transaction and worker',
  legend: 'three contexts, three databases, one request.', told: 'told',
}, {
  stages: ['Ruta', 'Caso de uso', 'Almacén', 'Outbox', 'Workers'],
  replay: 'Reproducción', real: 'La traza real', again: '↻ Repetir', step: 'Paso', zoom: 'el primer milisegundo, ampliado',
  viewAria: 'Reproducción o la captura real', stagesAria: 'Dónde está la petición', jumpAria: 'Saltar a un paso',
  shot: 'La misma petición en newt-monitor: cada caso de uso, consulta, transacción y worker',
  legend: 'tres contextos, tres bases de datos, una petición.', told: 'contado',
})

const time = ref(0)
const beat = ref(0)
const running = ref(false)
const view = ref<'replay' | 'real'>('replay')
let frame = 0

/** Where a time falls on the lane: its first millisecond takes half of it, so the request's own steps can be seen. */
function at(ms: number) { return ms <= 1 ? ms * 0.5 : 0.5 + ((ms - 1) / (END - 1)) * 0.5 }
function percent(ms: number) { return `${at(ms) * 100}%` }
function stretch(from: number, to: number) { return `${(at(to) - at(from)) * 100}%` }
function width(span: typeof spans[number]) { return Math.max(0, Math.min(time.value - span.start, span.duration)) }
const visible = computed(() => spans.map(span => time.value >= span.start - 0.0001))

function play() {
  cancelAnimationFrame(frame)
  if (reducedMotion()) { time.value = END; beat.value = beats.value.length - 1; return }
  running.value = true
  time.value = 0
  beat.value = 0
  let from = performance.now()
  const tick = (now: number) => {
    const current = beats.value[beat.value]!
    const next = beats.value[beat.value + 1]
    if (!next) { running.value = false; return }
    const hold = 1500
    const travel = next.at - current.at > 1 ? 1800 : 700
    const elapsed = now - from
    if (elapsed > hold) {
      const progress = Math.min(1, (elapsed - hold) / travel)
      const eased = 1 - Math.pow(1 - progress, 3)
      time.value = current.at + (next.at - current.at) * eased
      if (progress >= 1) { beat.value++; from = now }
    }
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}
function jump(index: number) {
  cancelAnimationFrame(frame)
  running.value = false
  beat.value = index
  time.value = beats.value[index]!.at
}

const root = ref<HTMLElement>()
onInView(root, () => { if (!running.value && time.value === 0) play() }, { threshold: 0.35 })
</script>

<template>
  <div ref="root" class="journey">
    <div class="board">
      <div class="toolbar">
        <div class="view" role="tablist" :aria-label="ui.viewAria">
          <button role="tab" :class="{ on: view === 'replay' }" :aria-selected="view === 'replay'" @click="view = 'replay'">{{ ui.replay }}</button>
          <button role="tab" :class="{ on: view === 'real' }" :aria-selected="view === 'real'" @click="view = 'real'">{{ ui.real }}</button>
        </div>
        <span class="clock"><i :class="{ live: running }" />{{ time.toFixed(2) }} ms</span>
        <button class="replay" type="button" @click="view = 'replay'; play()">{{ ui.again }}</button>
      </div>

      <div v-show="view === 'replay'" class="trace">
        <div class="ruler">
          <span>{{ ui.step }}</span>
          <div class="ticks"><span v-for="ms in [0, 0.25, 0.5, 0.75, 1, 2, 3, 4, 5]" :key="ms" :class="{ minor: ms % 1 }" :style="{ left: percent(ms) }">{{ ms % 1 ? String(ms).slice(1) : `${ms} ms` }}</span><em class="zoom" :style="{ width: percent(1) }">{{ ui.zoom }}</em></div>
        </div>
        <div class="rows">
          <div class="playhead" :style="{ left: `calc(var(--names) + (100% - var(--names) - 18px) * ${at(time)})` }" />
          <div v-for="(span, index) in spans" :key="span.name" class="row" :class="[span.kind, { shown: visible[index], focus: beats[beat]!.span === index }]">
            <div class="name" :style="{ paddingLeft: `${12 + span.depth * 14}px` }">
              <span v-if="span.kind === 'use' || span.kind === 'worker'" class="glyph">▷</span>
              <span v-else-if="span.kind === 'event'" class="glyph event">◇</span>
              <code>{{ span.name }}</code>
              <span v-if="span.ctx" class="ctx" :class="span.ctx">{{ span.ctx }}</span>
              <em v-if="span.detail">{{ span.detail === 'told' ? ui.told : span.detail }}</em>
            </div>
            <div class="lane">
              <span v-if="span.kind === 'worker'" class="wait" :style="{ left: percent(WORKERS_FROM), width: stretch(WORKERS_FROM, Math.max(WORKERS_FROM, Math.min(time, span.start))) }" />
              <span v-if="span.kind === 'event'" class="diamond" :style="{ left: percent(span.start) }" />
              <span v-else class="bar" :style="{ left: percent(span.start), width: `max(4px, ${stretch(span.start, span.start + width(span))})` }" />
              <span v-if="span.kind !== 'event' && visible[index]" class="ms" :style="{ left: `calc(${percent(span.start + width(span))} + 8px)` }">{{ width(span) < 0.1 ? width(span).toFixed(2) : width(span).toFixed(1) }} ms</span>
            </div>
          </div>
        </div>
      </div>

      <div v-show="view === 'real'" class="real">
        <Shot name="monitor-trace" :alt="ui.shot" />
      </div>
    </div>

    <aside class="narrator">
      <ol class="stages" :aria-label="ui.stagesAria">
        <li v-for="(stage, index) in ui.stages" :key="stage" :class="{ done: beats[beat]!.stage > index, on: beats[beat]!.stage === index }">{{ stage }}</li>
      </ol>
      <Transition name="beat" mode="out-in">
        <div :key="beat" class="beat">
          <span class="count">{{ String(beat + 1).padStart(2, '0') }} / {{ beats.length }}</span>
          <h3>{{ beats[beat]!.title }}</h3>
          <p>{{ beats[beat]!.text }}</p>
        </div>
      </Transition>
      <div class="steps" :aria-label="ui.jumpAria">
        <button v-for="(each, index) in beats" :key="each.title" :class="{ on: index === beat, done: index < beat }" :aria-label="each.title" @click="view = 'replay'; jump(index)" />
      </div>
      <p class="legend">
        <span class="ctx boards">boards</span> <span class="ctx auth">auth</span> <span class="ctx backoffice">backoffice</span>
        {{ ui.legend }}
      </p>
    </aside>
  </div>
</template>

<style scoped>
.journey { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, .75fr); gap: 28px; align-items: start; }
.board { --names: 46%; border-radius: 4px; background: var(--l-code-bg); border: 1px solid color-mix(in srgb, var(--l-code-ink) 8%, transparent); overflow: hidden; color: var(--l-code-ink); }
.toolbar { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: var(--l-code-bar); border-bottom: 1px solid color-mix(in srgb, var(--l-code-ink) 6%, transparent); }
.view { display: inline-flex; padding: 3px; border-radius: 4px; background: color-mix(in srgb, var(--l-code-ink) 5%, transparent); }
.view button { height: 30px; padding: 0 14px; border-radius: 4px; font-size: 13px; font-weight: 600; color: var(--l-code-dim); transition: all .2s ease; }
.view button.on { color: var(--l-code-ink); background: color-mix(in srgb, var(--l-code-ink) 10%, transparent); }
.clock { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-family: var(--vp-font-family-mono); font-size: 13px; color: var(--l-code-dim); font-variant-numeric: tabular-nums; }
.clock i { width: 8px; height: 8px; border-radius: 50%; background: var(--l-border-strong); }
.clock i.live { background: var(--l-green); animation: pulse 1.4s infinite; }
@keyframes pulse { 50% { opacity: .3; } }
.replay { height: 30px; padding: 0 12px; border-radius: 4px; font-size: 13px; font-weight: 600; color: var(--l-code-ink); border: 1px solid color-mix(in srgb, var(--l-code-ink) 12%, transparent); }
.replay:hover { border-color: var(--l-green); }

.ruler { display: grid; grid-template-columns: var(--names) 1fr; padding: 10px 0; font-size: 11.5px; color: var(--l-code-dim); border-bottom: 1px solid color-mix(in srgb, var(--l-code-ink) 6%, transparent); }
.ruler > span { padding-left: 14px; }
.ticks { position: relative; margin-right: 18px; }
.ticks span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.ticks span.minor { opacity: .55; }
.ticks span:last-of-type { transform: translateX(-100%); }
.zoom { position: absolute; left: 0; top: 18px; font-style: normal; font-size: 10px; text-align: center; color: var(--l-orange); border-top: 1px solid color-mix(in srgb, var(--l-orange) 40%, transparent); padding-top: 2px; }
.ruler { padding-bottom: 26px; }
.ticks span:first-child { transform: none; }
.rows { position: relative; padding: 4px 0 8px; }
.playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--l-orange); z-index: 2; pointer-events: none; }
.row { display: grid; grid-template-columns: var(--names) 1fr; align-items: center; height: 31px; border-bottom: 1px solid color-mix(in srgb, var(--l-code-ink) 4%, transparent); opacity: .12; transition: opacity .4s ease, background .4s ease; }
.row.shown { opacity: 1; }
.row.focus { background: color-mix(in srgb, var(--l-orange) 8%, transparent); }
.name { display: flex; align-items: center; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden; }
.name code { font-size: 12.5px; color: var(--l-code-ink); overflow: hidden; text-overflow: ellipsis; }
.name em { font-style: normal; font-size: 11.5px; color: var(--l-code-dim); overflow: hidden; text-overflow: ellipsis; }
.row.query .name code, .row.tx .name code { color: var(--l-code-dim); }
.row.http .name code { font-weight: 700; }
.glyph { color: var(--l-green); font-size: 11px; }
.glyph.event { color: var(--l-blue); font-size: 13px; }
.ctx { height: 18px; font-size: 10.5px; padding: 0 7px; }
.lane { position: relative; height: 100%; margin-right: 18px; }
.bar { position: absolute; top: 50%; height: 8px; margin-top: -4px; border-radius: 1px; transition: width .08s linear; }
.http .bar { background: var(--l-green); }
.use .bar { background: var(--l-blue); }
.query .bar, .tx .bar { background: var(--l-border-strong); }
.tx .bar { height: 10px; margin-top: -5px; }
.limit .bar { background: var(--l-orange); }
.worker .bar { background: var(--l-yellow); }
.wait { position: absolute; top: 50%; border-top: 1px dashed var(--l-border-strong); }
.diamond { position: absolute; top: 50%; width: 11px; height: 11px; margin: -6px 0 0 -5px; border: 2px solid var(--l-blue); transform: rotate(45deg); }
.row.event.shown .diamond { animation: told 1s ease-out; }
@keyframes told { from { opacity: 0; } }
.ms { position: absolute; top: 50%; transform: translateY(-50%); font-size: 11px; color: var(--l-code-dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
.real { max-height: 620px; overflow: auto; }

.narrator { position: sticky; top: calc(var(--vp-nav-height, 64px) + 24px); padding: 24px; border-radius: 4px; background: var(--l-panel); border: 1px solid var(--l-border); }
.stages { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.stages li { position: relative; padding: 4px 9px; border-radius: 2px; font-size: 12px; font-weight: 650; color: var(--l-ink-3); background: var(--l-bg-2); border: 1px solid var(--l-border); transition: all .4s ease; }
.stages li.done { color: var(--l-green-ink); border-color: color-mix(in srgb, var(--l-green) 35%, transparent); }
.stages li.on { color: var(--l-on-accent); background: var(--l-orange); border-color: var(--l-orange); }
.beat { min-height: 210px; margin-top: 26px; }
.count { font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--l-orange); font-weight: 700; }
.beat h3 { margin-top: 8px; font-size: 23px; line-height: 1.2; letter-spacing: -0.015em; font-weight: 650; color: var(--l-ink); }
.beat p { margin-top: 12px; font-size: 15.5px; line-height: 1.65; color: var(--l-ink-2); }
.steps { display: flex; gap: 6px; margin-top: 8px; }
.steps button { flex: 1; height: 3px; border-radius: 0; background: var(--l-border-strong); transition: background .3s ease; }
.steps button.done { background: color-mix(in srgb, var(--l-green) 55%, transparent); }
.steps button.on { background: var(--l-orange); }
.legend { margin-top: 22px; font-size: 13px; line-height: 2; color: var(--l-ink-3); }
.beat-enter-active, .beat-leave-active { transition: opacity .25s ease, transform .25s ease; }
.beat-enter-from { opacity: 0; transform: translateY(10px); }
.beat-leave-to { opacity: 0; transform: translateY(-10px); }

@media (max-width: 1100px) {
  .journey { grid-template-columns: minmax(0, 1fr); }
  .narrator { position: static; }
  .beat { min-height: 0; }
}
@media (max-width: 640px) {
  .board { --names: 52%; }
  .toolbar { gap: 8px; padding: 10px; }
  .view button { padding: 0 9px; font-size: 12px; white-space: nowrap; }
  .clock { white-space: nowrap; font-size: 12px; }
  .replay { padding: 0 9px; font-size: 0; }
  .replay::before { content: '↻'; font-size: 14px; }
  .name em, .ms, .ticks span:not(:first-child):not(:nth-child(5)):not(:last-of-type) { display: none; }
  .zoom { font-size: 9px; white-space: nowrap; overflow: hidden; }
  .name code { font-size: 11px; }
  .ctx { display: none; }
}
</style>
