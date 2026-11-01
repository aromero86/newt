<script setup lang="ts">
import { ref } from 'vue'
import { highlight } from './highlight'
import { onInView, reducedMotion, useTimers } from './motion'

/** How card.created is born in cooper: tracked by the entity, saved with it, run by four workers. */
const entity = [
  'static create(input: CardOpening, author: CardAuthor): Card {',
  '  const card = new Card(input, true)',
  '  card.author = author',
  '  card.trackEvent(new Card_Created({ ...card.toDTO(), ...author }))',
  '  return card',
  '}',
].map(highlight)

type State = 'idle' | 'running' | 'failed' | 'waiting' | 'done'
const workers = ref([
  { queue: 'card.indexCard', ctx: 'boards', state: 'idle' as State, note: '' },
  { queue: 'activity.recordCreated', ctx: 'boards', state: 'idle' as State, note: '' },
  { queue: 'metric.recordCard', ctx: 'backoffice', state: 'idle' as State, note: '' },
  { queue: 'card.leaveRemovedColumn', ctx: 'boards', state: 'idle' as State, note: '' },
])
const stage = ref(0)
const timers = useTimers()
let looping = false

function set(index: number, state: State, note: string) { workers.value[index]!.state = state; workers.value[index]!.note = note }

function run() {
  timers.clear()
  stage.value = 0
  workers.value.forEach((_, index) => set(index, 'idle', 'waiting'))
  if (reducedMotion()) {
    stage.value = 4
    workers.value.forEach((_, index) => set(index, 'done', index === 2 ? 'attempt 2 ✓' : 'attempt 1 ✓'))
    return
  }
  timers.after(700, () => { stage.value = 1 })
  timers.after(2000, () => { stage.value = 2 })
  timers.after(3300, () => { stage.value = 3 })
  timers.after(4300, () => {
    stage.value = 4
    workers.value.forEach((_, index) => set(index, 'running', 'attempt 1'))
  })
  timers.after(5600, () => { set(0, 'done', 'attempt 1 ✓'); set(3, 'done', 'attempt 1 ✓') })
  timers.after(6000, () => { set(1, 'done', 'attempt 1 ✓'); set(2, 'failed', 'attempt 1 ✕ timed out') })
  timers.after(7000, () => set(2, 'waiting', 'runs again in 2 s'))
  timers.after(8300, () => set(2, 'running', 'attempt 2'))
  timers.after(9600, () => { set(2, 'done', 'attempt 2 ✓'); stage.value = 5 })
  timers.after(13500, () => { if (looping) run() })
}

const root = ref<HTMLElement>()
onInView(root, () => { if (!looping) { looping = true; run() } }, { threshold: 0.3, leave: () => { looping = false } })

const points = [
  { title: 'Only the entity changes itself', text: 'With methods named after what happened, and it tracks the event that tells it.', from: 1, to: 1 },
  { title: 'Saved together, told after', text: 'The change and its event in one transaction, in the outbox beside the row. Told only once it commits.', from: 2, to: 3 },
  { title: 'Every reaction, a job', text: 'Run by a worker until it succeeds, with backoff. Keyed by the event\'s id, so a second run finds nothing to do.', from: 4, to: 5 },
]
</script>

<template>
  <div ref="root" class="birth">
    <div class="copy">
      <p class="l-eyebrow">Events, born in the entity</p>
      <h2 class="l-h2">What happened is told by <span class="l-ink">what changed.</span></h2>
      <p class="l-lead">
        In newt, an event is not a message you remember to publish. It is part of the change: the entity tracks it,
        the save writes it, the outbox delivers it.
      </p>
      <ol class="points">
        <li v-for="(point, index) in points" :key="point.title" :class="{ on: stage >= point.from && stage <= point.to, done: stage > point.to }">
          <span class="n">{{ index + 1 }}</span>
          <div>
            <h3>{{ point.title }}</h3>
            <p>{{ point.text }}</p>
          </div>
        </li>
      </ol>
    </div>

    <div class="lab" :data-stage="stage">
      <div class="l-window entity">
        <div class="l-window-bar"><i /><i /><i /><em>cooper/…/card/card.ts</em></div>
        <pre><code><span v-for="(line, index) in entity" :key="index" class="line" :class="{ hot: index === 3 && stage >= 1 }"><span v-html="line" /><span v-if="index === 3" class="spark" />
</span></code></pre>
      </div>

      <div class="wire" :class="{ flow: stage >= 2 }"><i /></div>

      <div class="tx" :class="{ open: stage >= 2, committed: stage >= 3 }">
        <div class="tx-head">
          <span>transaction</span>
          <span class="stamp">{{ stage >= 3 ? 'COMMIT ✓' : stage >= 2 ? 'BEGIN' : '' }}</span>
        </div>
        <div class="tx-row r1"><b>card</b> #26 “Write the release notes” <em>insert</em></div>
        <div class="tx-row r2"><b>outbox</b> card.created <em>4 jobs</em></div>
      </div>

      <svg class="fan" viewBox="0 0 400 70" aria-hidden="true" :class="{ drawn: stage >= 4 }">
        <path v-for="x in [50, 150, 250, 350]" :key="x" :d="`M200,0 C200,40 ${x},30 ${x},70`" pathLength="100" />
      </svg>

      <div class="workers">
        <div v-for="worker in workers" :key="worker.queue" class="worker" :class="worker.state">
          <span class="ctx" :class="worker.ctx">{{ worker.ctx }}</span>
          <code>{{ worker.queue.replace('.', '.\u200b') }}</code>
          <div class="track"><i /></div>
          <small>{{ worker.note }}</small>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.birth { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: clamp(32px, 6vw, 80px); align-items: center; }
.points { list-style: none; display: grid; gap: 12px; margin-top: 36px; }
.points li { display: flex; gap: 16px; padding: 16px 18px; border-radius: 6px; border: 1px solid transparent; transition: all .5s ease; opacity: .55; }
.points li.on { opacity: 1; background: var(--l-panel); border-color: color-mix(in srgb, var(--l-orange) 40%, transparent); box-shadow: var(--l-shadow); }
.points li.done { opacity: .9; }
.n { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: var(--l-ink-3); border: 1.5px solid var(--l-border-strong); transition: all .4s ease; }
.points li.on .n { color: var(--l-on-accent); background: var(--l-orange); border-color: var(--l-orange); }
.points li.done .n { color: var(--l-on-accent); background: var(--l-green); border-color: var(--l-green); }
.points h3 { font-size: 16.5px; font-weight: 750; color: var(--l-ink); }
.points p { margin-top: 4px; font-size: 14.5px; line-height: 1.55; color: var(--l-ink-2); }

.lab { position: relative; padding: 28px; border-radius: 6px; background: var(--l-panel); border: 1px solid var(--l-border); box-shadow: var(--l-shadow); }
.lab::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: radial-gradient(500px circle at 50% 0%, var(--l-glow-orange), transparent 60%); opacity: .7; pointer-events: none; }
.entity pre { padding: 16px 18px; font-size: 12.5px; }
.line { display: inline; position: relative; transition: background .4s ease; }
.line.hot { background: color-mix(in srgb, var(--l-orange) 16%, transparent); box-shadow: -18px 0 0 color-mix(in srgb, var(--l-orange) 16%, transparent), 18px 0 0 color-mix(in srgb, var(--l-orange) 16%, transparent); border-radius: 2px; }
.spark { display: inline-block; width: 10px; height: 10px; margin-left: 8px; border-radius: 50%; background: var(--l-orange); vertical-align: middle; opacity: 0; transform: scale(0); transition: all .5s cubic-bezier(.3,1.6,.5,1); box-shadow: 0 0 0 0 color-mix(in srgb, var(--l-orange) 60%, transparent); }
.lab[data-stage="1"] .spark { opacity: 1; transform: scale(1); animation: ping 1s infinite; }
@keyframes ping { to { box-shadow: 0 0 0 12px color-mix(in srgb, var(--l-orange) 0%, transparent); } }

.wire { position: relative; width: 2px; height: 36px; margin: 0 auto; background: var(--l-border-strong); overflow: hidden; }
.wire i { position: absolute; left: -3px; top: -12px; width: 8px; height: 12px; border-radius: 4px; background: var(--l-orange); box-shadow: 0 0 12px var(--l-orange); opacity: 0; }
.wire.flow i { animation: down .8s ease-in forwards; }
@keyframes down { 0% { opacity: 1; top: -12px; } 100% { opacity: 1; top: 36px; } }

.tx { position: relative; padding: 14px; border-radius: 6px; border: 1.5px dashed var(--l-border-strong); background: var(--l-bg); transition: all .5s ease; }
.tx.open { border-color: color-mix(in srgb, var(--l-orange) 60%, transparent); }
.tx.committed { border-style: solid; border-color: color-mix(in srgb, var(--l-green) 60%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--l-green) 12%, transparent); }
.tx-head { display: flex; justify-content: space-between; align-items: center; font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--l-ink-3); }
.stamp { font-weight: 800; letter-spacing: .06em; color: var(--l-orange); }
.tx.committed .stamp { color: var(--l-green-ink); animation: stamp .45s cubic-bezier(.3,1.6,.5,1); }
@keyframes stamp { from { transform: scale(1.8); opacity: 0; } }
.tx-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 10px 12px; border-radius: 4px; font-size: 13px; color: var(--l-ink-2); background: var(--l-panel-solid); border: 1px solid var(--l-border); opacity: 0; transform: translateY(6px); transition: all .45s ease; }
.tx-row b { font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--l-ink); }
.tx-row em { margin-left: auto; font-style: normal; font-size: 11.5px; font-family: var(--vp-font-family-mono); color: var(--l-ink-3); }
.tx.open .tx-row { opacity: 1; transform: none; }
.tx.open .r2 { transition-delay: .35s; }
.r2 b { color: var(--l-orange); }

.fan { display: block; width: 100%; height: auto; margin: -2px 0 -4px; }
.fan path { fill: none; stroke: var(--l-border-strong); stroke-width: 1.6; stroke-dasharray: 100; stroke-dashoffset: 100; transition: stroke-dashoffset .8s ease, stroke .4s ease; }
.fan.drawn path { stroke-dashoffset: 0; stroke: color-mix(in srgb, var(--l-green) 65%, transparent); }

.workers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.worker { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 6px; background: var(--l-panel-solid); border: 1px solid var(--l-border); transition: border-color .4s ease, box-shadow .4s ease; min-width: 0; }
.worker .ctx { align-self: flex-start; }
.worker code { font-size: 11px; color: var(--l-ink); line-height: 1.4; }
.track { height: 5px; border-radius: 3px; background: var(--l-border); overflow: hidden; }
.track i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--l-green); }
.worker.running .track i { animation: fill 1.25s ease-in-out forwards; }
.worker.done .track i { width: 100%; }
.worker.failed .track i { width: 70%; background: var(--l-red); }
.worker.waiting .track i { width: 0; }
.worker.done { border-color: color-mix(in srgb, var(--l-green) 50%, transparent); }
.worker.failed { border-color: color-mix(in srgb, var(--l-red) 60%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--l-red) 12%, transparent); animation: shake .4s; }
.worker.waiting { border-color: color-mix(in srgb, var(--l-orange) 55%, transparent); }
@keyframes fill { to { width: 100%; } }
@keyframes shake { 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
.worker small { font-size: 11px; font-family: var(--vp-font-family-mono); color: var(--l-ink-3); }
.worker.failed small { color: var(--l-red); }
.worker.done small { color: var(--l-green-ink); }
.worker.waiting small { color: var(--l-orange); }

@media (max-width: 1000px) { .birth { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) {
  .lab { padding: 16px; }
  .workers { grid-template-columns: 1fr 1fr; }
  .fan { display: none; }
  .tx { margin-bottom: 16px; }
  .entity pre { font-size: 11px; }
}
</style>
