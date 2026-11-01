<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import Hero from './Hero.vue'
import Marquee from './Marquee.vue'
import Story from './Story.vue'
import RequestJourney from './RequestJourney.vue'
import EventBirth from './EventBirth.vue'
import ContextMap from './ContextMap.vue'
import MonitorShowcase from './MonitorShowcase.vue'
import AskClaude from './AskClaude.vue'
import AgentTerminal from './AgentTerminal.vue'
import Bento from './Bento.vue'
import Counter from './Counter.vue'
import Shot from './Shot.vue'
import { reducedMotion } from './motion'
import './landing.css'

/** What scrolls into view fades in; how far down the page is, a line under the bar. */
const progress = ref<HTMLElement>()
let observer: IntersectionObserver | undefined
let frame = 0
function measure() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const scrolled = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight)
    progress.value?.style.setProperty('transform', `scaleX(${scrolled.toFixed(4)})`)
  })
}
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
  measure()
  addEventListener('scroll', measure, { passive: true })
})
onBeforeUnmount(() => {
  observer?.disconnect()
  removeEventListener('scroll', measure)
  cancelAnimationFrame(frame)
})

/** What a log says, line after line, for ever. */
const logs = [
  'POST /api/workspaces/01a1…/boards/01a1…/cards 201 4ms',
  'GET  /api/workspaces/01a1…/boards 200 1ms',
  'POST /api/workspaces/01a1…/boards/01a1…/cards 400 0ms',
  'job failed, retrying in 32s',
  'GET  /api/workspaces/01a1…/cards/01a1… 404 0ms',
  'PATCH /api/workspaces/01a1…/cards/01a1… 200 2ms',
  'POST /api/workspaces/01a1…/boards/01a1…/cards 400 1ms',
  'Error: connect ECONNREFUSED 10.0.3.7:587',
  'GET  /api/me 200 0ms',
  'job failed, retrying in 64s',
  'POST /oauth/token 200 3ms',
  'GET  /api/workspaces/01a1…/search?q=rel 200 2ms',
]
/** What newt-monitor says about the same minutes. */
const insights = [
  { code: 'card.create', ctx: 'boards', text: '368 errors in the hour, all of them ones it says may happen. 0 failures. p90 1 ms.' },
  { code: 'card.notifyAssignee.on.card.created', ctx: 'boards', text: 'Died after 5 attempts: MailNotSent, the mail server at smtp.cooper.dev:587 refused the connection.' },
  { code: 'access.check', ctx: 'auth', text: '0.1 ms of a 4 ms request to boards: the other context, asked through its use case.' },
]
const numbers = [
  { to: 101125, label: 'use case calls in an hour' },
  { to: 0, label: 'failures nobody expected' },
  { to: 0.94, decimals: 2, suffix: ' ms', label: 'p90 of every use case' },
  { to: 12867, label: 'jobs in, and as many out' },
]
</script>

<template>
  <div class="landing">
    <div class="scroll-line" aria-hidden="true"><i ref="progress" /></div>

    <Hero />
    <Marquee />

    <!-- The story: problem, then answer -->
    <section id="story" class="l-section story">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow">The story</p>
          <h2 class="l-h2">Every backend starts clean. <span class="l-ink">Then it grows.</span></h2>
          <p class="l-lead">These are the six ways it rots. Scroll through them, and watch what newt does about each.</p>
        </header>
        <Story />
      </div>
    </section>

    <!-- One request, replayed -->
    <section id="journey" class="l-section journey">
      <div class="l-grid-bg" aria-hidden="true" />
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow">Follow one request</p>
          <h2 class="l-h2">From a click <span class="l-ink">to the last worker.</span></h2>
          <p class="l-lead">
            One card created in cooper, newt's example application, replayed from the trace newt-monitor kept: three
            contexts, a rate limit, an idempotency key, one transaction, one event and four workers. In 4 milliseconds.
          </p>
        </header>
        <RequestJourney class="l-reveal" />
      </div>
    </section>

    <!-- Events -->
    <section id="events" class="l-section">
      <div class="l-container">
        <EventBirth class="l-reveal" />
      </div>
    </section>

    <!-- Contexts and modules -->
    <section id="contexts" class="l-section contexts">
      <div class="l-container two">
        <div class="l-reveal">
          <p class="l-eyebrow">Contexts and modules</p>
          <h2 class="l-h2">Boundaries you can see. <span class="l-ink">And that hold.</span></h2>
          <p class="l-lead">
            An application is bounded contexts, each with its own database. A context is modules, each owning one
            entity. They meet only through each other's use cases and events, never through a table.
          </p>
          <ul class="checks">
            <li>A context imports only the contexts it says it uses, and the lint keeps it.</li>
            <li>A use case writes into another module only from a worker reacting to an event.</li>
            <li>No cycles, between modules or between contexts.</li>
            <li>The application describes all of it, and the monitor draws it.</li>
          </ul>
          <a class="l-link" :href="withBase('/book/03-contexts')">Bounded contexts, in the book →</a>
        </div>
        <ContextMap class="l-reveal" style="--i: 1" />
      </div>
    </section>

    <!-- newt-monitor -->
    <section id="monitor" class="l-section monitor">
      <div class="monitor-sky" aria-hidden="true" />
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow">newt-monitor</p>
          <h2 class="l-h2">Production, explained <span class="l-ink">in your own words.</span></h2>
          <p class="l-lead">
            Your application already knows its contexts, modules, use cases, events and queues. newt-monitor asks it,
            and shows you every one of them running: not routes and status codes, but what your code calls things.
          </p>
        </header>

        <div class="versus l-reveal">
          <div class="logs">
            <p class="tag">Your logs say</p>
            <div class="log-window">
              <div class="log-track"><code v-for="(line, index) in [...logs, ...logs]" :key="index">{{ line }}</code></div>
            </div>
          </div>
          <div class="vs" aria-hidden="true">→</div>
          <div class="insights">
            <p class="tag good">newt-monitor says</p>
            <div v-for="(insight, index) in insights" :key="insight.code" class="insight l-reveal" :style="{ '--i': index + 2 }">
              <div class="insight-head"><code>{{ insight.code }}</code><span class="ctx" :class="insight.ctx">{{ insight.ctx }}</span></div>
              <p>{{ insight.text }}</p>
            </div>
          </div>
        </div>

        <MonitorShowcase class="l-reveal" />

        <div class="numbers l-reveal">
          <div v-for="(number, index) in numbers" :key="number.label" class="number" :style="{ '--i': index }">
            <strong><Counter :to="number.to" :decimals="number.decimals" :suffix="number.suffix" /></strong>
            <span>{{ number.label }}</span>
          </div>
        </div>
        <p class="numbers-note">cooper under a load test, as newt-monitor counted it.</p>

        <div class="promises">
          <div class="promise l-reveal" style="--i: 0">
            <span class="icon">◎</span>
            <h3>It knows your domain</h3>
            <p>Contexts, modules, use cases, events, queues and schedules as your code names them, and each use case's errors by their codes.</p>
          </div>
          <div class="promise l-reveal" style="--i: 1">
            <span class="icon">⛨</span>
            <h3>It never opens your database</h3>
            <p>The monitor asks; your application answers on a port of its own, every request signed. Payloads and rows stay where they are.</p>
          </div>
          <div class="promise l-reveal" style="--i: 2">
            <span class="icon">⌁</span>
            <h3>One monitor, every application</h3>
            <p>Register as many as you run. Each deploy is marked on every chart, and each version of their structure is kept to compare.</p>
          </div>
        </div>

        <AskClaude class="ask l-reveal" />

        <div class="center l-reveal">
          <a class="l-btn primary" :href="withBase('/book/40-monitor')">Meet newt-monitor <span class="arrow">→</span></a>
        </div>
      </div>
    </section>

    <!-- Agents -->
    <section id="agents" class="l-section">
      <div class="l-container">
        <AgentTerminal class="l-reveal" />
      </div>
    </section>

    <!-- Everything else -->
    <section class="l-section">
      <div class="l-container">
        <header class="l-head l-reveal">
          <p class="l-eyebrow">And everything a real backend needs</p>
          <h2 class="l-h2">Serious <span class="l-ink">from the first module.</span></h2>
        </header>
        <Bento class="l-reveal" />
      </div>
    </section>

    <!-- cooper -->
    <section class="l-section cooper">
      <div class="l-container two">
        <div class="l-reveal">
          <p class="l-eyebrow">Learn it on a real application</p>
          <h2 class="l-h2">Meet <span class="l-ink">cooper.</span></h2>
          <p class="l-lead">
            Boards of cards for teams: three contexts, sign-in through an OAuth server of its own, workspaces,
            invitations, search, a backoffice and an MCP server. The book explains every part of newt through it, with
            the code in front of you.
          </p>
          <a class="l-btn primary go" :href="withBase('/book/02-meet-cooper')">Meet cooper <span class="arrow">→</span></a>
        </div>
        <div class="fan l-reveal" style="--i: 1">
          <Shot class="card back2" name="cooper-backoffice" alt="cooper's backoffice" />
          <Shot class="card back1" name="cooper-boards" alt="cooper's boards" />
          <Shot class="card front" name="cooper-board" alt="A board in cooper, with its columns and cards" />
        </div>
      </div>
    </section>

    <!-- Call to action -->
    <section class="l-section cta">
      <div class="l-container">
        <div class="cta-box l-reveal">
          <div class="l-grid-bg" aria-hidden="true" />
          <div class="cta-glow" aria-hidden="true" />
          <h2 class="l-h2">Build something <span class="l-ink">that lasts.</span></h2>
          <p class="l-lead">Start with the essentials: fourteen chapters, from why newt exists to running it in production. Then go as deep as you like.</p>
          <div class="cta-actions">
            <a class="l-btn primary" :href="withBase('/book/00-how-to-read')">Read the book <span class="arrow">→</span></a>
            <a class="l-btn ghost" :href="withBase('/book/40-monitor')">The monitor</a>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scroll-line { position: fixed; top: var(--vp-nav-height, 64px); left: 0; right: 0; z-index: 30; height: 2px; pointer-events: none; }
.scroll-line i { display: block; height: 100%; transform-origin: 0 50%; transform: scaleX(0); background: linear-gradient(90deg, var(--l-green), #19b3a0, var(--l-orange)); box-shadow: 0 0 10px var(--l-glow-green); }

.journey { background: linear-gradient(180deg, transparent, var(--l-bg-2) 18%, var(--l-bg-2) 82%, transparent); }
.two { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: clamp(32px, 6vw, 80px); align-items: center; }
.checks { list-style: none; display: grid; gap: 14px; margin-top: 28px; }
.checks li { position: relative; padding-left: 34px; font-size: 15.5px; line-height: 1.55; color: var(--l-ink-2); }
.checks li::before { content: '✓'; position: absolute; left: 0; top: 0; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 800; color: #fff; background: var(--l-green); }

.monitor { overflow: hidden; }
.monitor-sky { position: absolute; inset: 0; z-index: 0; pointer-events: none; background: radial-gradient(900px 500px at 15% 10%, var(--l-glow-green), transparent 60%), radial-gradient(800px 500px at 90% 40%, var(--l-glow-blue), transparent 60%), radial-gradient(700px 500px at 30% 90%, var(--l-glow-orange), transparent 60%); opacity: .55; }
.monitor .l-container { position: relative; }

.versus { display: grid; grid-template-columns: minmax(0, 1fr) 48px minmax(0, 1fr); gap: 16px; align-items: stretch; margin-bottom: clamp(64px, 9vw, 112px); }
.tag { margin-bottom: 12px; font-size: 13px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--l-ink-3); }
.tag.good { color: var(--l-green-ink); }
.log-window { position: relative; height: 290px; overflow: hidden; padding: 0 18px; border-radius: 18px; background: var(--l-code-bg); border: 1px solid rgba(255,255,255,.06); mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); }
.log-track { display: flex; flex-direction: column; gap: 9px; animation: logs 22s linear infinite; }
.log-track code { font-size: 12px; color: #5d7068; white-space: nowrap; }
@keyframes logs { to { transform: translateY(calc(-50% - 4.5px)); } }
.vs { display: grid; place-items: center; font-size: 26px; color: var(--l-ink-3); }
.insights { display: grid; align-content: start; gap: 10px; }
.insight { padding: 16px 18px; border-radius: 16px; background: var(--l-panel); border: 1px solid color-mix(in srgb, var(--l-green) 30%, transparent); box-shadow: var(--l-shadow); backdrop-filter: blur(10px); }
.insight-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.insight-head code { font-size: 13px; font-weight: 700; color: var(--l-ink); overflow-wrap: anywhere; }
.insight p { margin-top: 6px; font-size: 14.5px; line-height: 1.55; color: var(--l-ink-2); }

.numbers { display: grid; grid-template-columns: repeat(4, 1fr); margin-top: clamp(64px, 9vw, 112px); border-radius: 22px; overflow: hidden; border: 1px solid var(--l-border); background: var(--l-panel); backdrop-filter: blur(10px); }
.number { padding: 30px 20px; text-align: center; }
.number + .number { border-left: 1px solid var(--l-border); }
.number strong { display: block; font-size: clamp(30px, 4vw, 46px); font-weight: 850; letter-spacing: -0.04em; line-height: 1; color: var(--l-ink); }
.number > span { display: block; margin-top: 10px; font-size: 13.5px; color: var(--l-ink-3); }
.numbers-note { margin-top: 12px; text-align: center; font-size: 12.5px; color: var(--l-ink-3); }

.promises { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: clamp(56px, 8vw, 96px) 0; }
.promise { padding: 26px; border-radius: 20px; background: var(--l-panel); border: 1px solid var(--l-border); }
.icon { display: grid; place-items: center; width: 40px; height: 40px; margin-bottom: 16px; border-radius: 12px; font-size: 20px; color: var(--l-green-ink); background: color-mix(in srgb, var(--l-green) 14%, transparent); }
.promise h3 { font-size: 17.5px; font-weight: 750; color: var(--l-ink); }
.promise p { margin-top: 8px; font-size: 14.5px; line-height: 1.6; color: var(--l-ink-2); }
.ask { margin-bottom: clamp(56px, 8vw, 96px); }
.center { text-align: center; }

.cooper .go { margin-top: 32px; }
.fan { position: relative; height: clamp(300px, 34vw, 460px); perspective: 1600px; }
.fan :deep(.card) { position: absolute; width: 82%; border-radius: 14px; overflow: hidden; border: 1px solid var(--l-border-strong); box-shadow: var(--l-shadow-big); transition: transform .6s cubic-bezier(.2,.7,.2,1); }
.fan :deep(.back2) { right: 0; top: 0; transform: rotateY(-14deg) rotateZ(4deg) translateZ(-80px); opacity: .85; }
.fan :deep(.back1) { right: 6%; top: 8%; transform: rotateY(-10deg) rotateZ(2deg) translateZ(-40px); }
.fan :deep(.front) { left: 0; top: 18%; transform: rotateY(-6deg); }
.fan:hover :deep(.back2) { transform: rotateY(-8deg) rotateZ(7deg) translate(30px, -24px); }
.fan:hover :deep(.back1) { transform: rotateY(-4deg) rotateZ(3deg) translate(14px, -10px); }
.fan:hover :deep(.front) { transform: rotateY(0) translate(-12px, 18px); }

.cta-box { position: relative; overflow: hidden; isolation: isolate; padding: clamp(56px, 9vw, 112px) 24px; border-radius: 32px; text-align: center; background: var(--l-panel); border: 1px solid var(--l-border); box-shadow: var(--l-shadow-big); }
.cta-box .l-grid-bg { z-index: -1; }
.cta-glow { position: absolute; inset: -30%; z-index: -2; background: conic-gradient(from 0deg at 50% 50%, var(--l-glow-green), var(--l-glow-orange), var(--l-glow-blue), var(--l-glow-green)); filter: blur(60px); animation: turn 18s linear infinite; opacity: .8; }
@keyframes turn { to { transform: rotate(360deg); } }
.cta-box .l-h2 { font-size: clamp(38px, 6vw, 72px); }
.cta-box .l-lead { margin-left: auto; margin-right: auto; max-width: 560px; }
.cta-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 36px; }

@media (max-width: 1000px) {
  .two { grid-template-columns: minmax(0, 1fr); }
  .versus { grid-template-columns: minmax(0, 1fr); }
  .vs { transform: rotate(90deg); height: 32px; }
  .numbers { grid-template-columns: 1fr 1fr; }
  .number:nth-child(3) { border-left: 0; }
  .number:nth-child(n + 3) { border-top: 1px solid var(--l-border); }
  .promises { grid-template-columns: minmax(0, 1fr); }
}
</style>
