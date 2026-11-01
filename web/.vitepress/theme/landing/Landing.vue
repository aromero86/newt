<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import RequestFlow from './RequestFlow.vue'
import ContextMap from './ContextMap.vue'
import MonitorTour from './MonitorTour.vue'
import Shot from './Shot.vue'

/** Sections fade in as they scroll into view; with reduced motion, they are simply there. */
let observer: IntersectionObserver | undefined
onMounted(() => {
  const revealed = document.querySelectorAll('.landing .reveal')
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    revealed.forEach(element => element.classList.add('shown'))
    return
  }
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('shown')
      observer?.unobserve(entry.target)
    }
  }, { threshold: 0.12 })
  revealed.forEach(element => observer!.observe(element))
})
onBeforeUnmount(() => observer?.disconnect())

/** The hero's code, typed line by line: a use case that changes an entity, which tells what happened. */
const heroLines = [
  { code: '@UseCase()', kind: 'decorator' },
  { code: 'async create(boardId: string, input: unknown) {', kind: 'plain' },
  { code: '  const card = await this.newCard(boardId, input, actingAuthor())', kind: 'plain' },
  { code: '  await this.repo.persistNew(card)', kind: 'save' },
  { code: '  return card.toDTO()', kind: 'plain' },
  { code: '}', kind: 'plain' },
]
const typed = ref(0)
const told = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
function typeNext() {
  if (typed.value < heroLines.length) {
    typed.value++
    timer = setTimeout(typeNext, 380)
    return
  }
  told.value = true
  timer = setTimeout(() => { typed.value = 0; told.value = false; timer = setTimeout(typeNext, 600) }, 5200)
}
onMounted(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { typed.value = heroLines.length; told.value = true; return }
  timer = setTimeout(typeNext, 500)
})
onBeforeUnmount(() => clearTimeout(timer))

/** The story: what goes wrong in a backend as it grows, and what newt does about it. */
const problems = [
  {
    pain: 'The logic leaks into the routes',
    story: 'A handler validates, checks permissions, writes three tables and sends an email. Six months later, nobody dares to touch it.',
    answer: 'A route does not think',
    how: 'It reads the request, calls one use case, answers. Each use case validates, loads, asks who may, lets the entity change itself, and saves once.',
    link: '/book/06-use-cases',
  },
  {
    pain: 'Events get lost',
    story: 'The row is saved, the process dies, the event is never published. The invoice is never sent, and nothing tells you.',
    answer: 'A transactional outbox',
    how: 'An event is written in the same transaction as the change it tells. A worker runs every reaction until it succeeds, with backoff, and keeps the ones that never do.',
    link: '/book/10-workers',
  },
  {
    pain: 'Two people, one record',
    story: 'Ana moves a card while Bob renames it. One of the changes silently disappears.',
    answer: 'Versions, and a second run',
    how: 'Every row has a version. A conflict runs the use case again on fresh data, on SQLite, Postgres and MySQL alike. Rules over several rows hold under a guard.',
    link: '/book/20-concurrency',
  },
  {
    pain: 'A tenant sees another\'s data',
    story: 'One forgotten where clause, and Acme reads Globex\'s boards.',
    answer: 'Scopes that repositories enforce',
    how: 'A repository of tenant rows says its scope, and sees only the current one. Saving a row of another scope throws. A stranger gets a 404.',
    link: '/book/22-tenants',
  },
  {
    pain: 'Nobody knows what calls what',
    story: 'Which module listens to card.created? What breaks if I change this payload? The answer lives in someone\'s head.',
    answer: 'The structure, drawn',
    how: 'Every module declares what it depends on. The lint keeps the boundaries, and the application describes itself to newt-monitor, which draws it.',
    link: '/book/42-structure',
  },
  {
    pain: 'AI writes code with no rails',
    story: 'Your coding agent is fast. It is also happy to put a transaction in a route and a fetch in a save.',
    answer: 'Rules a machine checks',
    how: 'An AGENTS.md versioned with the package, a lint that knows newt\'s anatomy, and runtime rules whose errors say what to do instead.',
    link: '/book/33-agents',
  },
]

const guarantees = [
  { title: 'Stores you can swap', text: 'SQLite, plain files, Postgres and MySQL behind one port, proven by one contract suite.' },
  { title: 'Time you can move', text: 'One clock per context drives timestamps, jobs and cron schedules. Tests move it instead of waiting.' },
  { title: 'Closed by default', text: 'Every route needs a session. Security headers, CSP with hashed scripts, body limits and an origin check come built in.' },
  { title: 'Rate limits where they belong', text: 'Per route, group, router or use case: by person, by address or by any key, in memory, a table or Redis.' },
  { title: 'Idempotent where it matters', text: 'POSTs that create take an Idempotency-Key; jobs key what must happen once by the event\'s id.' },
  { title: 'Bun, and only Bun', text: 'Bun.serve, bun:sqlite and Bun.SQL. Zod for every schema. No Express, no ORM, no build step to configure.' },
]
</script>

<template>
  <div class="landing">
    <!-- Hero -->
    <section class="hero">
      <div class="hero-glow" aria-hidden="true" />
      <div class="container hero-grid">
        <div class="hero-copy">
          <p class="eyebrow">A backend framework for Bun</p>
          <h1>Backends that stay clean.<br><span class="gradient">And a monitor that sees all of it.</span></h1>
          <p class="lead">
            newt gives your backend a shape that holds as it grows: bounded contexts, use cases, entities that tell what
            happened, and events that are never lost. newt-monitor then shows you that shape running in production, down to
            the last query.
          </p>
          <div class="actions">
            <a class="button primary" :href="withBase('/book/00-how-to-read')">Read the book</a>
            <a class="button ghost" href="#monitor">See the monitor</a>
          </div>
          <p class="fine">Open source · TypeScript · Bun · SQLite, Postgres, MySQL</p>
        </div>
        <div class="hero-code" aria-label="A use case of cooper, newt's example application">
          <div class="window">
            <div class="window-bar"><span /><span /><span /><em>card.module.ts</em></div>
            <pre><code><template v-for="(line, index) in heroLines" :key="index"><span v-if="index < typed" class="line" :class="line.kind">{{ line.code }}</span>
</template></code></pre>
          </div>
          <div class="event-pill" :class="{ on: told }">
            <span class="dot" /> card.created
            <span class="arrow">→</span> outbox
            <span class="arrow">→</span> 4 workers
          </div>
        </div>
      </div>
    </section>

    <!-- The story -->
    <section class="story">
      <div class="container">
        <header class="section-head reveal">
          <p class="eyebrow">The story</p>
          <h2>Every backend starts clean.</h2>
          <p class="lead">Then it grows. These are the ways it rots, and what newt does about each of them.</p>
        </header>
        <div class="story-list">
          <article v-for="(item, index) in problems" :key="item.pain" class="story-item reveal">
            <div class="pain">
              <span class="number">{{ String(index + 1).padStart(2, '0') }}</span>
              <h3>{{ item.pain }}</h3>
              <p>{{ item.story }}</p>
            </div>
            <div class="bridge" aria-hidden="true">→</div>
            <div class="answer">
              <h3>{{ item.answer }}</h3>
              <p>{{ item.how }}</p>
              <a :href="withBase(item.link)">How it works</a>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Follow a request -->
    <section class="flow">
      <div class="container">
        <header class="section-head reveal">
          <p class="eyebrow">Follow one request</p>
          <h2>From a click to the last worker.</h2>
          <p class="lead">
            One card created in cooper, newt's example application. Press play and watch where it goes: the same path
            newt-monitor draws for every request it keeps.
          </p>
        </header>
        <RequestFlow class="reveal" />
      </div>
    </section>

    <!-- Contexts and modules -->
    <section class="contexts">
      <div class="container two-col">
        <div class="reveal">
          <p class="eyebrow">Contexts and modules</p>
          <h2>Boundaries you can see, and that hold.</h2>
          <p class="lead">
            An application is bounded contexts, each with its own database. A context is modules, each owning one entity.
            They meet only through each other's use cases and events, never through a table.
          </p>
          <ul class="checks">
            <li>The lint refuses an import across a boundary nobody declared.</li>
            <li>A use case writes into another module only from a worker.</li>
            <li>Cycles between modules or contexts are refused.</li>
            <li>The application describes all of it, and the monitor draws it.</li>
          </ul>
          <a class="text-link" :href="withBase('/book/03-contexts')">Bounded contexts, in the book →</a>
        </div>
        <ContextMap class="reveal" />
      </div>
    </section>

    <!-- The monitor -->
    <section id="monitor" class="monitor">
      <div class="container">
        <header class="section-head reveal">
          <p class="eyebrow">newt-monitor</p>
          <h2>Production, explained in your own words.</h2>
        </header>
        <div class="versus reveal">
          <div class="versus-card before">
            <h3>Your logs say</h3>
            <pre><code>POST /api/workspaces/…/cards 400 0.8ms
GET  /api/workspaces/…/cards/… 404 0.3ms
job failed, retrying in 32s</code></pre>
          </div>
          <div class="versus-card after">
            <h3>newt-monitor says</h3>
            <ul>
              <li><code>card.create</code> refused 103 times today with <code>validation</code>, 1 ms at p90</li>
              <li><code>card.get</code> answers <code>card.not_found</code> to cards deleted a moment earlier</li>
              <li><code>card.notifyAssignee.on.card.created</code> died after 5 attempts: the mail server refused the connection</li>
            </ul>
          </div>
        </div>
        <MonitorTour class="reveal" />
        <div class="monitor-points reveal">
          <div>
            <h3>It knows your domain</h3>
            <p>Contexts, modules, use cases, events, queues and schedules, as your code names them. Not just routes and status codes.</p>
          </div>
          <div>
            <h3>It never opens your database</h3>
            <p>The monitor asks; the application answers on a port of its own, every request signed, every answer kept in the monitor's own files.</p>
          </div>
          <div>
            <h3>It answers Claude, too</h3>
            <p>An MCP server, behind OAuth, lets your AI assistant ask what got slower since the last deploy, or why a queue is growing.</p>
          </div>
        </div>
        <div class="center reveal">
          <a class="button primary" :href="withBase('/book/40-monitor')">Meet newt-monitor</a>
        </div>
      </div>
    </section>

    <!-- Built for agents -->
    <section class="agents">
      <div class="container two-col reverse">
        <div class="terminal reveal" aria-label="A terminal">
          <div class="window">
            <div class="window-bar"><span /><span /><span /><em>terminal</em></div>
            <pre><code><span class="prompt">$</span> bunx newt init
<span class="muted">wrote    AGENTS.md
wrote    CLAUDE.md
wrote    eslint.config.js</span>
<span class="prompt">$</span> bunx newt add module src/contexts/boards label
<span class="muted">wrote    …/label.schema.ts   label.ts   label.repository.ts
wrote    …/label.module.ts   label.routes.ts   label.test.ts</span>
<span class="prompt">$</span> bun run lint
<span class="ok">✓ the lint is happy</span>
<span class="prompt">$</span> bun test
<span class="bad">[write rule] label.attach writes to boards.card outside a
worker:</span><span class="muted"> write it from a worker reacting to an event,
or list it in its writesTo</span></code></pre>
          </div>
        </div>
        <div class="reveal">
          <p class="eyebrow">Built for coding agents</p>
          <h2>Rails your AI can't jump.</h2>
          <p class="lead">
            Structure is what makes an agent useful. newt ships its rules with the package, checks them three ways, and
            says what to do when one breaks.
          </p>
          <ul class="checks">
            <li><strong>AGENTS.md</strong>, versioned with the code it describes.</li>
            <li><strong>newt add module</strong> writes a module the lint already accepts.</li>
            <li><strong>Types, lint and runtime rules</strong>: three nets under every change.</li>
            <li><strong>The monitor's MCP server</strong>: the agent reads production too.</li>
          </ul>
          <a class="text-link" :href="withBase('/book/33-agents')">Built for coding agents →</a>
        </div>
      </div>
    </section>

    <!-- Guarantees -->
    <section class="guarantees">
      <div class="container">
        <header class="section-head reveal">
          <p class="eyebrow">And everything a real backend needs</p>
          <h2>Serious from the first module.</h2>
        </header>
        <div class="grid reveal">
          <div v-for="item in guarantees" :key="item.title" class="card">
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- cooper -->
    <section class="cooper">
      <div class="container two-col">
        <div class="reveal">
          <p class="eyebrow">Learn it on a real application</p>
          <h2>Meet cooper.</h2>
          <p class="lead">
            Boards of cards for teams: three contexts, sign-in with its own OAuth server, workspaces, invitations, search,
            a backoffice and an MCP server. The book explains every part of newt through it.
          </p>
          <a class="button primary" :href="withBase('/book/02-meet-cooper')">Meet cooper</a>
        </div>
        <Shot class="reveal" name="cooper-board" alt="A board in cooper, with its columns and cards" />
      </div>
    </section>

    <!-- Call to action -->
    <section class="cta">
      <div class="container center reveal">
        <h2>Build something that lasts.</h2>
        <p class="lead">Start with the essentials: fourteen chapters, from why newt exists to running it in production.</p>
        <div class="actions centered">
          <a class="button primary" :href="withBase('/book/00-how-to-read')">Read the book</a>
          <a class="button ghost" href="https://github.com/aromero86/newt">GitHub</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing { --gap: clamp(64px, 10vw, 128px); overflow-x: clip; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
section { padding: var(--gap) 0; position: relative; }
section + section { border-top: 1px solid var(--vp-c-divider); }

h1 { font-size: clamp(36px, 6vw, 64px); line-height: 1.05; letter-spacing: -0.03em; font-weight: 800; margin: 12px 0 20px; }
h2 { font-size: clamp(28px, 4vw, 44px); line-height: 1.1; letter-spacing: -0.02em; font-weight: 750; margin: 8px 0 16px; border: 0; padding: 0; }
h3 { font-size: 18px; font-weight: 650; margin: 0 0 8px; }
p { margin: 0; }
.lead { font-size: clamp(16px, 1.6vw, 19px); line-height: 1.65; color: var(--vp-c-text-2); max-width: 680px; }
.eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--vp-c-brand-1); }
.gradient { background: linear-gradient(110deg, var(--newt-green-2), var(--newt-orange-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.fine { margin-top: 20px; font-size: 13px; color: var(--vp-c-text-3); }
.center { text-align: center; }
.center .lead { margin: 0 auto; }
.section-head { margin-bottom: 48px; }

.actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
.actions.centered { justify-content: center; }
.button { display: inline-flex; align-items: center; padding: 12px 22px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none; transition: transform .15s ease, box-shadow .15s ease, background .15s ease; }
.button.primary { background: var(--vp-c-brand-2); color: #fff; box-shadow: 0 8px 24px -8px var(--newt-green-2); }
.button.primary:hover { transform: translateY(-1px); background: var(--vp-c-brand-1); }
.dark .button.primary { color: #052e22; }
.button.ghost { border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-1); }
.button.ghost:hover { border-color: var(--vp-c-brand-2); }
.text-link { display: inline-block; margin-top: 24px; font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none; }

/* Reveal on scroll */
.reveal { opacity: 0; transform: translateY(24px); transition: opacity .7s ease, transform .7s ease; }
.reveal.shown { opacity: 1; transform: none; }

/* Hero */
.hero { padding-top: clamp(48px, 8vw, 96px); }
.hero-glow { position: absolute; inset: -20% -10% auto; height: 560px; background: radial-gradient(600px 300px at 20% 30%, var(--newt-green-soft), transparent 70%), radial-gradient(500px 280px at 80% 20%, var(--newt-orange-soft), transparent 70%); pointer-events: none; }
.hero-grid { position: relative; display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }
.window { border-radius: 14px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-alt); box-shadow: 0 30px 60px -30px rgba(0,0,0,.35); overflow: hidden; }
.window-bar { display: flex; align-items: center; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); }
.window-bar span { width: 10px; height: 10px; border-radius: 50%; background: var(--vp-c-divider); }
.window-bar em { margin-left: 8px; font-style: normal; font-size: 12px; color: var(--vp-c-text-3); font-family: var(--vp-font-family-mono); }
.window pre { margin: 0; padding: 20px; min-height: 196px; font-size: 13.5px; line-height: 1.75; overflow-x: auto; font-family: var(--vp-font-family-mono); }
.line { display: inline; animation: appear .3s ease; }
.line.decorator { color: var(--newt-orange-1); }
.line.save { color: var(--vp-c-brand-1); font-weight: 600; }
@keyframes appear { from { opacity: 0; } to { opacity: 1; } }
.event-pill { display: inline-flex; align-items: center; gap: 8px; margin-top: 18px; padding: 10px 16px; border-radius: 999px; border: 1px solid var(--vp-c-divider); font-family: var(--vp-font-family-mono); font-size: 13px; color: var(--vp-c-text-3); transition: all .5s ease; }
.event-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vp-c-divider); transition: background .4s ease, box-shadow .4s ease; }
.event-pill.on { color: var(--vp-c-text-1); border-color: var(--vp-c-brand-2); background: var(--newt-green-soft); }
.event-pill.on .dot { background: var(--newt-orange-2); box-shadow: 0 0 0 6px var(--newt-orange-soft); }
.event-pill .arrow { color: var(--vp-c-text-3); }

/* Story */
.story-list { display: grid; gap: 20px; }
.story-item { display: grid; grid-template-columns: 1fr 48px 1fr; align-items: stretch; }
.pain, .answer { padding: 24px 28px; border-radius: 16px; }
.pain { background: var(--vp-c-bg-soft); border: 1px solid var(--vp-c-divider); }
.pain h3 { color: var(--vp-c-text-1); }
.pain p, .answer p { color: var(--vp-c-text-2); line-height: 1.6; font-size: 15px; }
.number { display: block; font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--newt-orange-1); margin-bottom: 6px; }
.answer { background: var(--newt-green-soft); border: 1px solid color-mix(in srgb, var(--vp-c-brand-2) 35%, transparent); }
.answer h3 { color: var(--vp-c-brand-1); }
.answer a { display: inline-block; margin-top: 12px; font-size: 14px; font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none; }
.bridge { display: grid; place-items: center; font-size: 22px; color: var(--vp-c-text-3); }

/* Two columns */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 64px; align-items: center; }
.checks { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 12px; }
.checks li { position: relative; padding-left: 30px; color: var(--vp-c-text-2); line-height: 1.55; }
.checks li::before { content: '✓'; position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: var(--vp-c-brand-1); background: var(--newt-green-soft); }

/* Monitor */
.monitor { background: linear-gradient(180deg, transparent, var(--vp-c-bg-soft) 30%, var(--vp-c-bg-soft) 70%, transparent); }
.versus { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 56px; }
.versus-card { padding: 24px; border-radius: 16px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg); }
.versus-card.before pre { margin: 0; font-size: 13px; line-height: 1.8; color: var(--vp-c-text-3); white-space: pre-wrap; font-family: var(--vp-font-family-mono); }
.versus-card.after { border-color: color-mix(in srgb, var(--vp-c-brand-2) 45%, transparent); box-shadow: 0 20px 40px -24px var(--newt-green-2); }
.versus-card ul { margin: 0; padding-left: 18px; display: grid; gap: 10px; color: var(--vp-c-text-2); line-height: 1.55; font-size: 15px; }
.versus-card code { font-size: 13px; }
.monitor-points { display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; margin: 56px 0 40px; }
.monitor-points p { color: var(--vp-c-text-2); line-height: 1.6; font-size: 15px; }

/* Agents */
.terminal pre { min-height: 0; font-size: 13px; line-height: 1.7; }
.prompt { color: var(--newt-orange-1); }
.muted { color: var(--vp-c-text-3); }
.ok { color: var(--vp-c-brand-1); }
.bad { color: #e5484d; }

/* Guarantees */
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
.card { padding: 24px; border-radius: 16px; border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-soft); transition: border-color .2s ease, transform .2s ease; }
.card:hover { border-color: var(--vp-c-brand-2); transform: translateY(-2px); }
.card p { color: var(--vp-c-text-2); line-height: 1.6; font-size: 15px; }

/* CTA */
.cta { padding-bottom: calc(var(--gap) * 1.2); }
.cta h2 { font-size: clamp(32px, 5vw, 56px); }

@media (max-width: 960px) {
  .hero-grid, .two-col, .versus { grid-template-columns: 1fr; gap: 40px; }
  .two-col.reverse > :first-child { order: 2; }
  .story-item { grid-template-columns: 1fr; }
  .bridge { transform: rotate(90deg); height: 40px; }
  .grid, .monitor-points { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .container { padding: 0 16px; }
  .window pre { font-size: 12px; padding: 14px; }
}
</style>
