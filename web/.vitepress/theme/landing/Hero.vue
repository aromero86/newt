<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { withBase } from 'vitepress'
import Shot from './Shot.vue'
import Counter from './Counter.vue'
import { reducedMotion, trackPointer } from './motion'

/** cooper as newt-monitor counts it: what it is made of, read from its code. */
const stats = [
  { to: 3, label: 'bounded contexts' },
  { to: 25, label: 'modules' },
  { to: 150, label: 'use cases' },
  { to: 28, label: 'domain events' },
  { to: 36, label: 'queues' },
]

/** The monitor's window lies back, and straightens as the page scrolls to it. */
const stage = ref<HTMLElement>()
let frame = 0
function straighten() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (!stage.value) return
    const top = stage.value.getBoundingClientRect().top
    const progress = Math.min(1, Math.max(0, 1 - (top - innerHeight * 0.12) / (innerHeight * 0.55)))
    stage.value.style.setProperty('--p', progress.toFixed(3))
  })
}
onMounted(() => {
  if (reducedMotion()) { stage.value?.style.setProperty('--p', '1'); return }
  straighten()
  addEventListener('scroll', straighten, { passive: true })
  addEventListener('resize', straighten, { passive: true })
})
onBeforeUnmount(() => {
  removeEventListener('scroll', straighten)
  removeEventListener('resize', straighten)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <section class="hero" @pointermove="trackPointer">
    <div class="aurora" aria-hidden="true"><i /><i /><i /></div>
    <div class="l-grid-bg" aria-hidden="true" />
    <div class="spotlight" aria-hidden="true" />

    <div class="l-container copy">
      <a class="badge" :href="withBase('/book/46-asking-claude')">
        <span class="badge-new">New</span> newt-monitor answers Claude, over MCP <span class="badge-arrow">→</span>
      </a>
      <h1>
        Backends that stay clean.<br>
        <span class="shine">A monitor that sees all of it.</span>
      </h1>
      <p class="lead">
        newt is a backend framework for Bun that gives your code a shape that holds as it grows: bounded contexts,
        use cases, entities that tell what happened, events that are never lost. newt-monitor then shows you that
        shape running in production, in your own words, down to the last query.
      </p>
      <div class="actions">
        <a class="l-btn primary" :href="withBase('/book/00-how-to-read')">Read the book <span class="arrow">→</span></a>
        <a class="l-btn ghost" href="#monitor">See the monitor</a>
      </div>
      <p class="fine">TypeScript · Bun · SQLite, Postgres, MySQL · Zod · Kysely</p>
    </div>

    <div ref="stage" class="stage l-container">
      <div class="glow" aria-hidden="true" />
      <div class="browser">
        <div class="bar">
          <span class="lights"><i /><i /><i /></span>
          <span class="url"><b>●</b> monitor · cooper · traces · POST /api/workspaces/:workspaceId/boards/:boardId/cards</span>
        </div>
        <div class="screen">
          <Shot name="monitor-trace" alt="newt-monitor showing the trace of one request to cooper: every use case, query, transaction and worker" eager />
        </div>
      </div>

      <div class="chip c1 l-glass"><span class="ok" /> Went well <em>27 steps · 4 ms</em></div>
      <div class="chip c2 l-glass"><span class="diamond">◇</span> card.created <em>told after commit → 4 workers</em></div>
      <div class="chip c3 l-glass"><span class="meter"><i /></span> api <em>291 of 600 left</em></div>
      <div class="chip c4 l-glass"><span class="ctx auth">auth</span> access.check <em>another context, by its use case</em></div>
    </div>

    <div class="l-container">
      <ul class="stats">
        <li v-for="(stat, index) in stats" :key="stat.label" :style="{ '--i': index }">
          <strong><Counter :to="stat.to" /></strong>
          <span>{{ stat.label }}</span>
        </li>
      </ul>
      <p class="stats-note">cooper, the example application of the book, as newt-monitor reads it from its code.</p>
    </div>
  </section>
</template>

<style scoped>
.hero { position: relative; padding: clamp(56px, 9vw, 112px) 0 clamp(64px, 8vw, 104px); isolation: isolate; overflow: hidden; }

.aurora { position: absolute; inset: -10% -10% 30%; z-index: -2; filter: blur(70px); opacity: .9; pointer-events: none; }
.aurora i { position: absolute; border-radius: 50%; animation: drift 18s ease-in-out infinite alternate; }
.aurora i:nth-child(1) { width: 52vw; height: 40vw; left: 4%; top: 0; background: radial-gradient(circle, var(--l-glow-green), transparent 65%); }
.aurora i:nth-child(2) { width: 44vw; height: 36vw; right: 2%; top: 4%; background: radial-gradient(circle, var(--l-glow-orange), transparent 65%); animation-duration: 22s; animation-delay: -6s; }
.aurora i:nth-child(3) { width: 40vw; height: 30vw; left: 30%; top: 30%; background: radial-gradient(circle, var(--l-glow-blue), transparent 65%); animation-duration: 26s; animation-delay: -12s; }
@keyframes drift { 0% { transform: translate(0, 0) scale(1); } 50% { transform: translate(6vw, 4vw) scale(1.12); } 100% { transform: translate(-4vw, 2vw) scale(.95); } }
.l-grid-bg { z-index: -1; mask-image: radial-gradient(ellipse 70% 60% at 50% 20%, #000 30%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 20%, #000 30%, transparent 75%); }
.spotlight { position: absolute; inset: 0; z-index: -1; pointer-events: none; background: radial-gradient(420px circle at var(--x, 50%) var(--y, 20%), var(--l-glow-green), transparent 70%); opacity: .55; transition: opacity .3s ease; }

.copy { text-align: center; }
.badge { display: inline-flex; align-items: center; gap: 10px; padding: 5px 14px 5px 5px; border-radius: 999px; font-size: 13.5px; font-weight: 550; color: var(--l-ink-2); background: var(--l-panel); border: 1px solid var(--l-border); backdrop-filter: blur(10px); transition: border-color .2s ease, transform .2s ease; animation: rise .8s cubic-bezier(.2,.7,.2,1) both; }
.badge:hover { border-color: var(--l-green); transform: translateY(-1px); }
.badge-new { padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 750; color: #fff; background: linear-gradient(90deg, var(--l-green), #19b3a0); }
.badge-arrow { color: var(--l-green-ink); }

h1 { margin-top: 28px; font-size: clamp(44px, 8vw, 96px); line-height: .98; letter-spacing: -0.052em; font-weight: 850; color: var(--l-ink); text-wrap: balance; animation: rise .9s .08s cubic-bezier(.2,.7,.2,1) both; }
.shine { background: linear-gradient(90deg, var(--l-green) 0%, #19b3a0 25%, var(--l-orange) 50%, #19b3a0 75%, var(--l-green) 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shine 9s linear infinite; }
@keyframes shine { to { background-position: -200% 0; } }
.lead { max-width: 720px; margin: 28px auto 0; font-size: clamp(17px, 1.7vw, 20px); line-height: 1.6; color: var(--l-ink-2); text-wrap: pretty; animation: rise .9s .16s cubic-bezier(.2,.7,.2,1) both; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 36px; animation: rise .9s .24s cubic-bezier(.2,.7,.2,1) both; }
.fine { margin-top: 22px; font-size: 13px; color: var(--l-ink-3); letter-spacing: .02em; animation: rise .9s .3s cubic-bezier(.2,.7,.2,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(18px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }

.stage { --p: 0; position: relative; margin-top: clamp(56px, 8vw, 88px); max-width: 1180px; perspective: 1800px; animation: rise 1.1s .35s cubic-bezier(.2,.7,.2,1) both; }
.glow { position: absolute; left: 10%; right: 10%; top: 12%; bottom: -6%; z-index: -1; background: radial-gradient(ellipse at center, var(--l-glow-green), transparent 70%); filter: blur(50px); opacity: calc(.5 + var(--p) * .5); }
.browser {
  border-radius: 18px; overflow: hidden; background: var(--l-code-bg); border: 1px solid var(--l-border-strong); box-shadow: var(--l-shadow-big);
  transform-origin: 50% 0;
  transform: rotateX(calc((1 - var(--p)) * 24deg)) scale(calc(.9 + var(--p) * .1)) translateY(calc((1 - var(--p)) * -24px));
  will-change: transform;
}
.bar { display: flex; align-items: center; gap: 16px; height: 44px; padding: 0 16px; background: var(--l-code-bar); border-bottom: 1px solid rgba(255,255,255,.06); }
.lights { display: flex; gap: 7px; }
.lights i { width: 11px; height: 11px; border-radius: 50%; background: #ff5f57; }
.lights i:nth-child(2) { background: #febc2e; }
.lights i:nth-child(3) { background: #28c840; }
.url { flex: 1; min-width: 0; height: 26px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-radius: 8px; background: rgba(255,255,255,.05); color: #8ea39a; font-size: 12px; font-family: var(--vp-font-family-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.url b { color: #28c840; font-size: 9px; }
.screen { position: relative; max-height: min(64vw, 720px); overflow: hidden; }
.screen::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 30%; background: linear-gradient(transparent, var(--l-bg)); pointer-events: none; }

.chip { position: absolute; z-index: 2; display: flex; align-items: center; gap: 9px; padding: 10px 14px; font-size: 13.5px; font-weight: 650; color: var(--l-ink); font-family: var(--vp-font-family-mono); border-radius: 14px; white-space: nowrap; animation: float 7s ease-in-out infinite; opacity: calc(var(--p) * 1.4 - .2); }
.chip em { font-style: normal; font-weight: 500; color: var(--l-ink-3); font-family: var(--vp-font-family-base); font-size: 12.5px; }
.c1 { left: -10px; top: 14%; }
.c2 { right: -16px; top: 30%; animation-delay: -2s; }
.c3 { left: -24px; top: 54%; animation-delay: -4s; }
.c4 { right: 0; top: 70%; animation-delay: -1s; }
@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.ok { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px rgba(34, 197, 94, .2); }
.diamond { color: var(--l-blue); font-size: 15px; }
.meter { position: relative; width: 44px; height: 6px; border-radius: 6px; background: var(--l-border-strong); overflow: hidden; }
.meter i { position: absolute; inset: 0 auto 0 0; width: 48%; border-radius: 6px; background: var(--l-orange); animation: meter 4s ease-in-out infinite; }
@keyframes meter { 0% { width: 70%; } 50% { width: 44%; } 100% { width: 70%; } }

.stats { list-style: none; display: grid; grid-template-columns: repeat(5, 1fr); margin-top: clamp(40px, 6vw, 72px); border-top: 1px solid var(--l-border); border-bottom: 1px solid var(--l-border); }
.stats li { padding: 26px 8px; text-align: center; }
.stats li + li { border-left: 1px solid var(--l-border); }
.stats strong { display: block; font-size: clamp(32px, 4vw, 48px); font-weight: 800; letter-spacing: -0.04em; line-height: 1; background: linear-gradient(180deg, var(--l-ink), color-mix(in srgb, var(--l-ink) 55%, transparent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.stats li > span { display: block; margin-top: 10px; font-size: 13.5px; color: var(--l-ink-3); }
.stats-note { margin-top: 14px; text-align: center; font-size: 12.5px; color: var(--l-ink-3); }

@media (max-width: 960px) {
  .chip { display: none; }
  .stats { grid-template-columns: repeat(3, 1fr); }
  .stats li:nth-child(4) { border-left: 0; }
  .stats li:nth-child(n + 4) { border-top: 1px solid var(--l-border); }
}
@media (max-width: 560px) {
  .badge { font-size: 12px; white-space: nowrap; }
  .url { font-size: 10.5px; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .stats li:nth-child(odd) { border-left: 0; }
  .stats li:nth-child(4) { border-left: 1px solid var(--l-border); }
  .stats li:nth-child(n + 3) { border-top: 1px solid var(--l-border); }
}
</style>
