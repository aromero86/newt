<script setup lang="ts">
import { computed, ref } from 'vue'
import Shot from './Shot.vue'
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
const beats = [
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
const stages = ['Route', 'Use case', 'Store', 'Outbox', 'Workers']

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
  if (reducedMotion()) { time.value = END; beat.value = beats.length - 1; return }
  running.value = true
  time.value = 0
  beat.value = 0
  let from = performance.now()
  const tick = (now: number) => {
    const current = beats[beat.value]!
    const next = beats[beat.value + 1]
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
  time.value = beats[index]!.at
}

const root = ref<HTMLElement>()
onInView(root, () => { if (!running.value && time.value === 0) play() }, { threshold: 0.35 })
</script>

<template>
  <div ref="root" class="journey">
    <div class="board">
      <div class="toolbar">
        <div class="view" role="tablist" aria-label="Replay or the real screenshot">
          <button role="tab" :class="{ on: view === 'replay' }" :aria-selected="view === 'replay'" @click="view = 'replay'">Live replay</button>
          <button role="tab" :class="{ on: view === 'real' }" :aria-selected="view === 'real'" @click="view = 'real'">The real trace</button>
        </div>
        <span class="clock"><i :class="{ live: running }" />{{ time.toFixed(2) }} ms</span>
        <button class="replay" type="button" @click="view = 'replay'; play()">↻ Replay</button>
      </div>

      <div v-show="view === 'replay'" class="trace">
        <div class="ruler">
          <span>Step</span>
          <div class="ticks"><span v-for="ms in [0, 0.25, 0.5, 0.75, 1, 2, 3, 4, 5]" :key="ms" :class="{ minor: ms % 1 }" :style="{ left: percent(ms) }">{{ ms % 1 ? String(ms).slice(1) : `${ms} ms` }}</span><em class="zoom" :style="{ width: percent(1) }">first millisecond, zoomed in</em></div>
        </div>
        <div class="rows">
          <div class="playhead" :style="{ left: `calc(var(--names) + (100% - var(--names) - 18px) * ${at(time)})` }" />
          <div v-for="(span, index) in spans" :key="span.name" class="row" :class="[span.kind, { shown: visible[index], focus: beats[beat]!.span === index }]">
            <div class="name" :style="{ paddingLeft: `${12 + span.depth * 14}px` }">
              <span v-if="span.kind === 'use' || span.kind === 'worker'" class="glyph">▷</span>
              <span v-else-if="span.kind === 'event'" class="glyph event">◇</span>
              <code>{{ span.name }}</code>
              <span v-if="span.ctx" class="ctx" :class="span.ctx">{{ span.ctx }}</span>
              <em v-if="span.detail">{{ span.detail }}</em>
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
        <Shot name="monitor-trace" alt="The same request in newt-monitor: every use case, query, transaction and worker" />
      </div>
    </div>

    <aside class="narrator">
      <ol class="stages" aria-label="Where the request is">
        <li v-for="(stage, index) in stages" :key="stage" :class="{ done: beats[beat]!.stage > index, on: beats[beat]!.stage === index }">{{ stage }}</li>
      </ol>
      <Transition name="beat" mode="out-in">
        <div :key="beat" class="beat">
          <span class="count">{{ String(beat + 1).padStart(2, '0') }} / {{ beats.length }}</span>
          <h3>{{ beats[beat]!.title }}</h3>
          <p>{{ beats[beat]!.text }}</p>
        </div>
      </Transition>
      <div class="steps" aria-label="Jump to a step">
        <button v-for="(each, index) in beats" :key="each.title" :class="{ on: index === beat, done: index < beat }" :aria-label="each.title" @click="view = 'replay'; jump(index)" />
      </div>
      <p class="legend">
        <span class="ctx boards">boards</span> <span class="ctx auth">auth</span> <span class="ctx backoffice">backoffice</span>
        three contexts, three databases, one request.
      </p>
    </aside>
  </div>
</template>

<style scoped>
.journey { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, .75fr); gap: 28px; align-items: start; }
.board { --names: 46%; border-radius: 20px; background: var(--l-code-bg); border: 1px solid rgba(255,255,255,.08); box-shadow: var(--l-shadow-big); overflow: hidden; color: #d7e4dd; }
.toolbar { display: flex; align-items: center; gap: 14px; padding: 12px 14px; background: var(--l-code-bar); border-bottom: 1px solid rgba(255,255,255,.06); }
.view { display: inline-flex; padding: 3px; border-radius: 10px; background: rgba(255,255,255,.05); }
.view button { height: 30px; padding: 0 14px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #8ea39a; transition: all .2s ease; }
.view button.on { color: #fff; background: rgba(255,255,255,.1); }
.clock { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; font-family: var(--vp-font-family-mono); font-size: 13px; color: #b9cbc2; font-variant-numeric: tabular-nums; }
.clock i { width: 8px; height: 8px; border-radius: 50%; background: #3b4a44; }
.clock i.live { background: #22c55e; box-shadow: 0 0 0 0 rgba(34,197,94,.6); animation: pulse 1.4s infinite; }
@keyframes pulse { to { box-shadow: 0 0 0 10px rgba(34,197,94,0); } }
.replay { height: 30px; padding: 0 12px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #d7e4dd; border: 1px solid rgba(255,255,255,.12); }
.replay:hover { border-color: #22c58f; }

.ruler { display: grid; grid-template-columns: var(--names) 1fr; padding: 10px 0; font-size: 11.5px; color: #6f8379; border-bottom: 1px solid rgba(255,255,255,.06); }
.ruler > span { padding-left: 14px; }
.ticks { position: relative; margin-right: 18px; }
.ticks span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.ticks span.minor { opacity: .55; }
.ticks span:last-of-type { transform: translateX(-100%); }
.zoom { position: absolute; left: 0; top: 18px; font-style: normal; font-size: 10px; text-align: center; color: #fb8a3c; border-top: 1px solid rgba(251,138,60,.4); padding-top: 2px; }
.ruler { padding-bottom: 26px; }
.ticks span:first-child { transform: none; }
.rows { position: relative; padding: 4px 0 8px; }
.playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: linear-gradient(transparent, #fb8a3c 10%, #fb8a3c 90%, transparent); box-shadow: 0 0 12px #fb8a3c; z-index: 2; pointer-events: none; }
.row { display: grid; grid-template-columns: var(--names) 1fr; align-items: center; height: 31px; border-bottom: 1px solid rgba(255,255,255,.035); opacity: .12; transition: opacity .4s ease, background .4s ease; }
.row.shown { opacity: 1; }
.row.focus { background: linear-gradient(90deg, rgba(251,138,60,.1), transparent 70%); }
.name { display: flex; align-items: center; gap: 7px; min-width: 0; white-space: nowrap; overflow: hidden; }
.name code { font-size: 12.5px; color: #e6f0eb; overflow: hidden; text-overflow: ellipsis; }
.name em { font-style: normal; font-size: 11.5px; color: #6f8379; overflow: hidden; text-overflow: ellipsis; }
.row.query .name code, .row.tx .name code { color: #b9cbc2; }
.row.http .name code { font-weight: 700; }
.glyph { color: #22c58f; font-size: 11px; }
.glyph.event { color: #5b95ff; font-size: 13px; }
.ctx { height: 18px; font-size: 10.5px; padding: 0 7px; }
.lane { position: relative; height: 100%; margin-right: 18px; }
.bar { position: absolute; top: 50%; height: 8px; margin-top: -4px; border-radius: 8px; transition: width .08s linear; }
.http .bar { background: linear-gradient(90deg, #16a34a, #22c55e); box-shadow: 0 0 14px rgba(34,197,94,.45); }
.use .bar { background: #3b82f6; box-shadow: 0 0 12px rgba(59,130,246,.5); }
.query .bar, .tx .bar { background: #4b5a54; }
.tx .bar { height: 10px; margin-top: -5px; }
.limit .bar { background: #fb8a3c; box-shadow: 0 0 12px rgba(251,138,60,.5); }
.worker .bar { background: linear-gradient(90deg, #16a34a, #22c55e); box-shadow: 0 0 14px rgba(34,197,94,.4); }
.wait { position: absolute; top: 50%; border-top: 1px dashed #4b5a54; }
.diamond { position: absolute; top: 50%; width: 11px; height: 11px; margin: -6px 0 0 -5px; border: 2px solid #5b95ff; transform: rotate(45deg); box-shadow: 0 0 14px rgba(91,149,255,.8); }
.row.event.shown .diamond { animation: told 1s ease-out; }
@keyframes told { 0% { transform: rotate(45deg) scale(3); opacity: 0; } 100% { transform: rotate(45deg) scale(1); opacity: 1; } }
.ms { position: absolute; top: 50%; transform: translateY(-50%); font-size: 11px; color: #8ea39a; white-space: nowrap; font-variant-numeric: tabular-nums; }
.real { max-height: 620px; overflow: auto; }

.narrator { position: sticky; top: calc(var(--vp-nav-height, 64px) + 24px); padding: 26px; border-radius: 20px; background: var(--l-panel); border: 1px solid var(--l-border); box-shadow: var(--l-shadow); backdrop-filter: blur(12px); }
.stages { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.stages li { position: relative; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; color: var(--l-ink-3); background: var(--l-bg-2); border: 1px solid var(--l-border); transition: all .4s ease; }
.stages li.done { color: var(--l-green-ink); border-color: color-mix(in srgb, var(--l-green) 35%, transparent); }
.stages li.on { color: #fff; background: var(--l-orange); border-color: var(--l-orange); box-shadow: 0 6px 18px -6px var(--l-orange); }
.beat { min-height: 210px; margin-top: 26px; }
.count { font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--l-orange); font-weight: 700; }
.beat h3 { margin-top: 8px; font-size: 26px; line-height: 1.15; letter-spacing: -0.02em; font-weight: 800; color: var(--l-ink); }
.beat p { margin-top: 12px; font-size: 15.5px; line-height: 1.65; color: var(--l-ink-2); }
.steps { display: flex; gap: 6px; margin-top: 8px; }
.steps button { flex: 1; height: 6px; border-radius: 6px; background: var(--l-border-strong); transition: background .3s ease; }
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
