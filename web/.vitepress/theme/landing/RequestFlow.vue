<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Shot from './Shot.vue'

/** One card created in cooper, as newt-monitor kept its trace: every step, in order. */
const steps = [
  { lane: 'http', title: 'POST /api/workspaces/:workspaceId/boards/:boardId/cards', note: 'The router takes the request. A route does not think: it reads the body as it came and calls one use case.' },
  { lane: 'use', title: 'session.authenticate', note: 'Who is asking: the session cookie, checked against a hash. No session, a 401; no route is open unless it says so.' },
  { lane: 'guard', title: 'api · 291 of 600 left', note: 'The route\'s rate limit, counted per person. Past it, a 429 with Retry-After.' },
  { lane: 'guard', title: 'idempotency_key', note: 'A POST that creates takes an Idempotency-Key: asked twice, it answers once.' },
  { lane: 'use', title: 'member.enter → auth: access.check', note: 'May they? boards asks auth, another context, through its use case, then enters the workspace scope.' },
  { lane: 'use', title: 'card.create', note: 'The use case validates the input, loads the board and its columns, and lets the entity create itself.' },
  { lane: 'store', title: 'transaction: card_counter, card.insert', note: 'One save, one transaction. The card gets its number from a counter row, under a guard, on any store.' },
  { lane: 'event', title: 'card.created, told', note: 'The entity tracked the event; it is written to the outbox in the same transaction, and told only once it commits.' },
  { lane: 'worker', title: '4 workers run: index, activity, metric, column', note: 'Each reaction is a job, run by a worker until it succeeds, safe to run twice. One of them belongs to another context: the metric module of backoffice.' },
]
const lanes: Record<string, string> = { http: 'HTTP', use: 'Use case', guard: 'Guard', store: 'Store', event: 'Event', worker: 'Worker' }

const current = ref(-1)
const playing = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

function play() {
  clearInterval(timer)
  playing.value = true
  current.value = 0
  timer = setInterval(() => {
    if (current.value >= steps.length - 1) { clearInterval(timer); playing.value = false; return }
    current.value++
  }, 1300)
}
function pick(index: number) {
  clearInterval(timer)
  playing.value = false
  current.value = index
}
onBeforeUnmount(() => clearInterval(timer))
const note = computed(() => (current.value >= 0 ? steps[current.value]!.note : 'Press play, or pick any step.'))
</script>

<template>
  <div class="flow">
    <div class="steps">
      <button class="play" type="button" @click="play">{{ playing ? 'Playing…' : current >= 0 ? 'Play again' : 'Play the request' }}</button>
      <ol>
        <li v-for="(step, index) in steps" :key="step.title" :class="[step.lane, { done: index < current, active: index === current }]">
          <button type="button" @click="pick(index)">
            <span class="lane">{{ lanes[step.lane] }}</span>
            <span class="title">{{ step.title }}</span>
          </button>
        </li>
      </ol>
      <p class="note" aria-live="polite">{{ note }}</p>
    </div>
    <div class="trace">
      <Shot name="monitor-trace" alt="The trace of a card created in cooper, in newt-monitor: every use case, query and worker" />
      <p class="caption">The same request in newt-monitor: 27 steps in 4 ms, then its workers.</p>
    </div>
  </div>
</template>

<style scoped>
.flow { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 40px; align-items: start; }
.play { padding: 10px 18px; border-radius: 999px; font-weight: 600; font-size: 14px; background: var(--vp-c-brand-2); color: #fff; margin-bottom: 20px; }
ol { list-style: none; margin: 0; padding: 0; position: relative; }
ol::before { content: ''; position: absolute; left: 11px; top: 8px; bottom: 8px; width: 2px; background: var(--vp-c-divider); }
li { position: relative; padding-left: 36px; margin: 0 0 6px; }
li::before { content: ''; position: absolute; left: 4px; top: 13px; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--vp-c-divider); background: var(--vp-c-bg); transition: all .35s ease; }
li.done::before { background: var(--vp-c-brand-2); border-color: var(--vp-c-brand-2); }
li.active::before { background: var(--newt-orange-2); border-color: var(--newt-orange-2); box-shadow: 0 0 0 6px var(--newt-orange-soft); }
li button { width: 100%; text-align: left; padding: 8px 12px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; transition: background .3s ease; }
li button:hover { background: var(--vp-c-bg-soft); }
li.active button { background: var(--newt-green-soft); }
.lane { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--vp-c-text-3); }
li.event .lane { color: var(--newt-orange-1); }
li.worker .lane { color: var(--vp-c-brand-1); }
.title { font-family: var(--vp-font-family-mono); font-size: 13px; color: var(--vp-c-text-1); word-break: break-word; }
.note { margin-top: 16px; min-height: 72px; padding: 14px 16px; border-radius: 12px; background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-2); line-height: 1.6; font-size: 15px; }
.caption { margin-top: 12px; text-align: center; font-size: 14px; color: var(--vp-c-text-3); }
@media (max-width: 960px) { .flow { grid-template-columns: 1fr; } }
</style>
