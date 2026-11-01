<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import Shot from './Shot.vue'
import { onInView, reducedMotion, trackPointer } from './motion'

/**
 * What newt-monitor shows of an application, one screen each, with what to look at on it: each hotspot is where
 * it is on the screenshot, in percent of its width and height. `ratio` is the screenshot's height over its width.
 */
const screens = [
  {
    key: 'overview', label: 'Overview', shot: 'monitor-overview', ratio: 0.625, path: 'cooper',
    title: 'The whole application, at a glance',
    text: 'What it is made of, read from its code. Its instances, disk, memory and event loop. Every use case\'s calls, errors, failures and times, from the last hour to the last year, with every deploy marked.',
    link: '/book/43-metrics',
    spots: [
      { x: 53, y: 29, label: '150 use cases, read from the code' },
      { x: 61, y: 60, label: '0 failures nobody expected' },
      { x: 67, y: 76, label: 'A deploy, marked on every chart' },
    ],
  },
  {
    key: 'structure', label: 'Structure', shot: 'monitor-graph', ratio: 0.903, path: 'cooper/contexts/boards/card',
    title: 'What uses what, drawn from the code',
    text: 'Each module with what it uses and what uses it, across contexts. Every use case says whether it writes only to its own module, and whether it runs again on a conflict.',
    link: '/book/42-structure',
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
    link: '/book/43-metrics',
    spots: [
      { x: 53, y: 31.5, label: '368 errors it says may happen' },
      { x: 74, y: 31.5, label: '0 failures' },
      { x: 68.5, y: 40.5, label: 'p99, beside the hour before' },
      { x: 38, y: 51.2, label: 'Since the deploy' },
    ],
  },
  {
    key: 'traces', label: 'Traces', shot: 'monitor-trace', ratio: 0.903, path: 'cooper/traces/01a1…',
    title: 'One request, down to the last query',
    text: 'The use cases it called, in its context and in others, every query with its criteria and rows, the transaction, the event told, and the workers that ran after it.',
    link: '/book/44-traces',
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
    link: '/book/45-queues',
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
    link: '/book/45-queues',
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
    link: '/book/43-metrics',
    spots: [],
  },
]
/** Each screen shows this long, and its screenshot scrolls in the frame's 16:10. */
const DWELL = 8
const FRAME = 0.625

const current = ref(0)
const cycle = ref(0)
const playing = ref(false)
const screen = computed(() => screens[current.value]!)

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
function next() { if (!reducedMotion()) pick((current.value + 1) % screens.length) }

const root = ref<HTMLElement>()
onInView(root, () => { playing.value = true }, { threshold: 0.3, leave: () => { playing.value = false } })

function tilt(event: PointerEvent) {
  trackPointer(event)
  const element = event.currentTarget as HTMLElement
  const box = element.getBoundingClientRect()
  element.style.setProperty('--rx', `${((event.clientY - box.top) / box.height - 0.5) * -5}deg`)
  element.style.setProperty('--ry', `${((event.clientX - box.left) / box.width - 0.5) * 6}deg`)
}
function untilt(event: PointerEvent) {
  const element = event.currentTarget as HTMLElement
  element.style.setProperty('--rx', '0deg')
  element.style.setProperty('--ry', '0deg')
}
</script>

<template>
  <div ref="root" class="showcase" :class="{ playing }" :style="{ '--dwell': `${DWELL}s` }">
    <div class="tabs" role="tablist" aria-label="What newt-monitor shows">
      <div v-for="(each, index) in screens" :key="each.key" role="tab" tabindex="0" @keydown.enter="pick(index)" :aria-selected="index === current" :class="{ on: index === current }" @click="pick(index)">
        <span class="tab-label">{{ each.label }}</span>
        <span class="tab-body">
          <strong>{{ each.title }}</strong>
          <span>{{ each.text }}</span>
          <a :href="withBase(each.link)" @click.stop>In the book →</a>
        </span>
        <span class="progress"><i v-if="index === current" :key="cycle" @animationend="next" /></span>
      </div>
    </div>

    <div class="stage" @pointermove="tilt" @pointerleave="untilt">
      <div class="halo" aria-hidden="true" />
      <div class="browser">
        <div class="bar">
          <span class="lights"><i /><i /><i /></span>
          <span class="url"><b>🔒</b> monitor.your-company.dev/apps/{{ screen.path }}</span>
        </div>
        <div class="frame">
          <div :key="`${current}-${cycle}`" class="pan" :style="{ '--pan': pan }">
            <Shot :name="screen.shot" :alt="screen.title" />
            <span v-for="spot in spots" :key="spot.label" class="spot" :class="{ left: spot.left }" :style="{ left: `${spot.x}%`, top: `${spot.y}%`, animationDelay: spot.delay }">
              <i /><em>{{ spot.label }}</em>
            </span>
          </div>
          <div class="sheen" aria-hidden="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.showcase { display: grid; grid-template-columns: minmax(0, .62fr) minmax(0, 1.38fr); gap: clamp(24px, 4vw, 48px); align-items: center; }

.tabs { display: grid; gap: 4px; }
.tabs > [role=tab] { cursor: pointer; outline-offset: 2px; position: relative; display: block; width: 100%; text-align: left; padding: 14px 18px 16px; border-radius: 16px; border: 1px solid transparent; transition: background .3s ease, border-color .3s ease; }
.tabs > [role=tab]:hover { background: var(--l-panel); }
.tabs > [role=tab].on { background: var(--l-panel); border-color: var(--l-border); box-shadow: var(--l-shadow); }
.tab-label { display: block; font-size: 15.5px; font-weight: 700; color: var(--l-ink-3); transition: color .3s ease; }
.on .tab-label { color: var(--l-ink); }
.tab-body { display: flex; flex-direction: column; overflow: hidden; max-height: 0; transition: max-height .6s ease; }
.on .tab-body { max-height: 260px; }
.tab-body strong { margin-top: 8px; font-size: 18px; line-height: 1.25; color: var(--l-ink); letter-spacing: -0.01em; }
.tab-body span { margin-top: 6px; font-size: 14.5px; line-height: 1.55; color: var(--l-ink-2); }
.tab-body a { margin-top: 8px; font-size: 13.5px; font-weight: 650; color: var(--l-green-ink); }
.progress { position: absolute; left: 18px; right: 18px; bottom: 6px; height: 2px; border-radius: 2px; background: transparent; overflow: hidden; }
.on .progress { background: var(--l-border); }
.progress i { display: block; height: 100%; width: 100%; transform-origin: 0 50%; transform: scaleX(0); background: linear-gradient(90deg, var(--l-green), var(--l-orange)); animation: progress var(--dwell) linear forwards; animation-play-state: paused; }
.playing .progress i { animation-play-state: running; }
.showcase:hover .progress i { animation-play-state: paused; }
@keyframes progress { to { transform: scaleX(1); } }

.stage { --rx: 0deg; --ry: 0deg; position: relative; perspective: 1600px; }
.halo { position: absolute; inset: 6% 4% -4%; z-index: -1; background: radial-gradient(ellipse at var(--x, 50%) var(--y, 50%), var(--l-glow-green), transparent 65%), radial-gradient(ellipse at 80% 90%, var(--l-glow-orange), transparent 60%); filter: blur(40px); }
.browser { border-radius: 18px; overflow: hidden; background: var(--l-code-bg); border: 1px solid var(--l-border-strong); box-shadow: var(--l-shadow-big); transform: rotateX(var(--rx)) rotateY(var(--ry)); transition: transform .25s ease-out; }
.bar { display: flex; align-items: center; gap: 16px; height: 42px; padding: 0 16px; background: var(--l-code-bar); border-bottom: 1px solid rgba(255,255,255,.06); }
.lights { display: flex; gap: 7px; }
.lights i { width: 11px; height: 11px; border-radius: 50%; background: #ff5f57; }
.lights i:nth-child(2) { background: #febc2e; }
.lights i:nth-child(3) { background: #28c840; }
.url { flex: 1; min-width: 0; height: 26px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 8px; background: rgba(255,255,255,.05); color: #8ea39a; font-size: 12px; font-family: var(--vp-font-family-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.url b { font-size: 10px; filter: grayscale(1); }
.frame { position: relative; aspect-ratio: 16 / 10; overflow: hidden; }
.pan { position: relative; animation: pan var(--dwell) ease-in-out both, enter .6s ease both; animation-play-state: paused; }
.playing .pan { animation-play-state: running; }
.showcase:hover .pan, .showcase:hover .spot { animation-play-state: paused; }
@keyframes pan { 0%, 30% { transform: translateY(0); } 85%, 100% { transform: translateY(var(--pan)); } }
@keyframes enter { from { opacity: 0; filter: blur(6px); } to { opacity: 1; filter: none; } }
.sheen { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(500px circle at var(--x, 50%) var(--y, 0%), rgba(255,255,255,.07), transparent 60%); }

.spot { position: absolute; z-index: 1; width: 0; height: 0; opacity: 0; animation: spot .5s cubic-bezier(.3,1.5,.5,1) both; animation-play-state: paused; }
.playing .spot { animation-play-state: running; }
@keyframes spot { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
.spot i { position: absolute; left: -7px; top: -7px; width: 14px; height: 14px; border-radius: 50%; background: var(--l-orange); border: 2px solid #fff; box-shadow: 0 0 0 0 rgba(251,138,60,.7); animation: ring 1.8s infinite; }
@keyframes ring { to { box-shadow: 0 0 0 16px rgba(251,138,60,0); } }
.spot em { position: absolute; left: 16px; top: -15px; padding: 6px 11px; border-radius: 10px; font-style: normal; font-size: 12.5px; font-weight: 650; white-space: nowrap; color: #fff; background: rgba(12, 20, 17, .88); border: 1px solid rgba(251,138,60,.55); box-shadow: 0 10px 30px -10px rgba(0,0,0,.6); backdrop-filter: blur(6px); }
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
