<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { onInView, reducedMotion, trackPointer } from './motion'

/** The rate limit's meter: a person's requests taking from 600, a 429 when none are left, then a new window. */
const left = ref(600)
const refused = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
const root = ref<HTMLElement>()
onInView(root, () => {
  if (timer || reducedMotion()) { left.value = 291; return }
  timer = setInterval(() => {
    if (refused.value) return
    left.value = Math.max(0, left.value - 9 - Math.floor(Math.random() * 22))
    if (left.value === 0) {
      refused.value = true
      setTimeout(() => { refused.value = false; left.value = 600 }, 1800)
    }
  }, 160)
}, { threshold: 0.2, leave: () => { clearInterval(timer); timer = undefined } })
onBeforeUnmount(() => clearInterval(timer))

const stores = ['SQLite', 'Files', 'Postgres', 'MySQL']
const headers = [
  'x-content-type-options: nosniff',
  'referrer-policy: strict-origin-when-cross-origin',
  'x-frame-options: DENY',
  'strict-transport-security: max-age=31536000',
  'content-security-policy: script-src \'sha256-…\'',
  '413 · the body is too large',
  '403 · cross_origin_refused',
  '401 · not_signed_in',
]
</script>

<template>
  <div ref="root" class="bento">
    <article class="cell wide" @pointermove="trackPointer">
      <div class="vis stores">
        <span v-for="(store, index) in stores" :key="store" :style="{ '--i': index }">{{ store }}</span>
        <em>describeStoreContract ✓</em>
      </div>
      <h3>Stores you can swap</h3>
      <p>SQLite, plain files, Postgres and MySQL behind one port, proven by one contract suite. Start on a file, grow into a server, change nothing in your modules.</p>
    </article>

    <article class="cell" @pointermove="trackPointer">
      <div class="vis clock">
        <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" /><line class="h" x1="40" y1="40" x2="40" y2="20" /><line class="m" x1="40" y1="40" x2="40" y2="12" /><circle cx="40" cy="40" r="3" class="pin" /></svg>
        <code>time += DAY_MS<br>await base.schedules.tick()</code>
      </div>
      <h3>Time you can move</h3>
      <p>One clock per context drives timestamps, jobs and cron schedules. Tests move it instead of waiting.</p>
    </article>

    <article class="cell" @pointermove="trackPointer">
      <div class="vis headers">
        <div class="ticker"><code v-for="(header, index) in [...headers, ...headers]" :key="index">{{ header }}</code></div>
      </div>
      <h3>Closed by default</h3>
      <p>Every route needs a session. Security headers, HSTS, a CSP with hashed scripts, body limits and an origin check, built in.</p>
    </article>

    <article class="cell wide" @pointermove="trackPointer">
      <div class="vis limit" :class="{ refused }">
        <div class="meter"><i :style="{ width: `${(left / 600) * 100}%` }" /></div>
        <div class="readout">
          <code v-if="!refused"><b>api</b> · {{ left }} of 600 left</code>
          <code v-else class="no">429 · Retry-After: 41</code>
        </div>
        <div class="scopes"><span>route</span><span>group</span><span>router</span><span>use case</span><span class="sep" /><span>per person</span><span>per address</span><span>any key</span><span class="sep" /><span>memory</span><span>table</span><span>Redis</span></div>
      </div>
      <h3>Rate limits where they belong</h3>
      <p>On a route, a group, a router or a use case; counted by person, by address or by any key you name; kept in memory, a table or Redis. Each one shows up in its trace.</p>
    </article>

    <article class="cell" @pointermove="trackPointer">
      <div class="vis idem">
        <div class="reqs"><span>POST · key 7f3a</span><span>POST · key 7f3a</span></div>
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <path id="idem-a" d="M0,20 C40,20 40,40 80,40" /><path id="idem-b" d="M0,60 C40,60 40,40 80,40" />
          <circle r="3"><animateMotion dur="2.4s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.4;1" calcMode="linear"><mpath href="#idem-a" /></animateMotion></circle>
          <circle r="3" class="again"><animateMotion dur="2.4s" begin=".6s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;.4;1" calcMode="linear"><mpath href="#idem-b" /></animateMotion></circle>
        </svg>
        <div class="srv"><b>201 · one card</b><small>the second gets the first answer</small></div>
      </div>
      <h3>Idempotent where it matters</h3>
      <p>A POST that creates takes an Idempotency-Key. A job keys what must happen once by its event's id.</p>
    </article>

    <article class="cell wide" @pointermove="trackPointer">
      <div class="vis bun">
        <code>Bun.serve</code><code>bun:sqlite</code><code>Bun.SQL</code><code>zod</code><code>kysely</code>
      </div>
      <h3>Bun, and only Bun</h3>
      <p>Bun.serve, bun:sqlite and Bun.SQL underneath; Zod for every schema; Kysely when a query needs SQL. No Express, no ORM, no build step to configure.</p>
    </article>
  </div>
</template>

<style scoped>
.bento { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.cell { position: relative; overflow: hidden; display: flex; flex-direction: column; padding: 26px; border-radius: 6px; background: var(--l-panel); border: 1px solid var(--l-border); box-shadow: var(--l-shadow); transition: transform .3s ease, border-color .3s ease; isolation: isolate; }
.cell.wide { grid-column: span 2; }
.cell::before { content: ''; position: absolute; inset: 0; z-index: -1; background: radial-gradient(360px circle at var(--x, -100%) var(--y, -100%), var(--l-glow-green), transparent 65%); opacity: 0; transition: opacity .3s ease; }
.cell:hover::before { opacity: 1; }
.cell:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--l-green) 40%, transparent); }
.cell h3 { margin-top: auto; padding-top: 22px; font-size: 19px; font-weight: 750; letter-spacing: -0.01em; color: var(--l-ink); }
.cell p { margin-top: 8px; font-size: 14.5px; line-height: 1.6; color: var(--l-ink-2); }
.vis { min-height: 120px; display: flex; align-items: center; }

.stores { flex-wrap: wrap; gap: 10px; }
.stores span { padding: 12px 18px; border-radius: 6px; font-weight: 700; font-size: 15px; color: var(--l-ink-2); background: var(--l-bg-2); border: 1px solid var(--l-border); animation: lit 6s infinite; animation-delay: calc(var(--i) * 1.5s); }
@keyframes lit { 0%, 20% { color: var(--l-green-ink); background: color-mix(in srgb, var(--l-green) 16%, var(--l-panel-solid)); border-color: var(--l-green); box-shadow: 0 10px 24px -10px var(--l-glow-green); transform: translateY(-3px); } 26%, 100% { } }
.stores em { flex-basis: 100%; font-style: normal; font-family: var(--vp-font-family-mono); font-size: 12.5px; color: var(--l-green-ink); }

.clock { gap: 18px; }
.clock svg { width: 76px; height: 76px; flex: none; }
.clock circle { fill: none; stroke: var(--l-border-strong); stroke-width: 2; }
.clock .pin { fill: var(--l-orange); stroke: none; }
.clock line { stroke: var(--l-ink); stroke-width: 3; stroke-linecap: round; transform-origin: 40px 40px; }
.clock .m { stroke: var(--l-orange); stroke-width: 2; animation: spin 1.2s linear infinite; }
.clock .h { animation: spin 14.4s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.clock code { font-size: 12px; line-height: 1.7; color: var(--l-ink-2); }

.headers { overflow: hidden; height: 120px; mask-image: linear-gradient(transparent, #000 25%, #000 75%, transparent); -webkit-mask-image: linear-gradient(transparent, #000 25%, #000 75%, transparent); align-items: flex-start; }
.ticker { display: flex; flex-direction: column; gap: 8px; animation: up 16s linear infinite; }
.ticker code { font-size: 12px; white-space: nowrap; color: var(--l-green-ink); }
.ticker code:nth-child(n + 6):nth-child(-n + 8), .ticker code:nth-child(n + 14) { color: var(--l-red); }
@keyframes up { to { transform: translateY(calc(-50% - 4px)); } }

.limit { flex-direction: column; align-items: stretch; justify-content: center; gap: 12px; }
.meter { height: 12px; border-radius: 4px; background: var(--l-bg-2); border: 1px solid var(--l-border); overflow: hidden; }
.meter i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--l-orange), var(--l-yellow)); transition: width .16s linear; }
.limit.refused .meter { border-color: var(--l-red); box-shadow: 0 0 0 4px color-mix(in srgb, var(--l-red) 15%, transparent); }
.readout code { font-size: 14px; color: var(--l-ink); font-variant-numeric: tabular-nums; }
.readout .no { color: var(--l-red); font-weight: 800; }
.scopes { display: flex; flex-wrap: wrap; gap: 6px; }
.scopes span { padding: 4px 9px; border-radius: 4px; font-size: 11.5px; font-weight: 600; color: var(--l-ink-2); background: var(--l-bg-2); border: 1px solid var(--l-border); }
.scopes .sep { padding: 0; width: 1px; border: 0; background: var(--l-border-strong); }

.idem { gap: 10px; }
.reqs { display: grid; gap: 22px; }
.reqs span { padding: 6px 10px; border-radius: 4px; font-size: 11.5px; font-family: var(--vp-font-family-mono); font-weight: 600; color: var(--l-ink); background: var(--l-bg-2); border: 1px solid var(--l-border); white-space: nowrap; }
.idem svg { flex: 1; min-width: 40px; height: 80px; overflow: visible; }
.idem path { fill: none; stroke: var(--l-border-strong); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.idem circle { fill: var(--l-green); }
.idem circle.again { fill: var(--l-orange); }
.srv { display: grid; gap: 4px; padding: 10px 14px; border-radius: 4px; color: var(--l-on-accent); background: var(--l-green); box-shadow: 0 10px 24px -10px var(--l-glow-green); }
.srv b { font-size: 13px; white-space: nowrap; }
.srv small { font-size: 11px; opacity: .85; max-width: 120px; line-height: 1.3; }

.bun { flex-wrap: wrap; gap: 10px; }
.bun code { padding: 10px 14px; border-radius: 4px; font-size: 14px; font-weight: 650; color: var(--l-ink); background: linear-gradient(110deg, var(--l-bg-2) 40%, color-mix(in srgb, var(--l-green) 22%, var(--l-bg-2)) 50%, var(--l-bg-2) 60%); background-size: 300% 100%; border: 1px solid var(--l-border); animation: shimmer 5s linear infinite; }
.bun code:nth-child(2) { animation-delay: .3s; }
.bun code:nth-child(3) { animation-delay: .6s; }
.bun code:nth-child(4) { animation-delay: .9s; }
.bun code:nth-child(5) { animation-delay: 1.2s; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -200% 0; } }

@media (max-width: 960px) { .bento { grid-template-columns: 1fr 1fr; } }
@media (max-width: 640px) { .bento { grid-template-columns: minmax(0, 1fr); } .cell.wide { grid-column: auto; } }
</style>
