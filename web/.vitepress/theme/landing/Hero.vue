<script setup lang="ts">
import { withBase } from 'vitepress'
import Shot from './Shot.vue'
import Counter from './Counter.vue'
import HeroLogo from './HeroLogo.vue'
import { useCopy } from './i18n'

const copy = useCopy({
  kicker: 'A backend framework for Bun',
  news: 'newt-monitor now answers Claude, over MCP',
  title: 'Backends that stay clean.',
  subtitle: 'A monitor that sees all of it.',
  lead: 'newt gives your code a shape that holds as it grows: bounded contexts, use cases, entities that tell what happened, events that are never lost. newt-monitor shows you that shape running in production, in your own words, down to the last query.',
  read: 'Read the manual',
  monitor: 'See the monitor',
  shot: 'newt-monitor showing the trace of one request to cooper: every use case, query, transaction and worker',
  stats: ['bounded contexts', 'modules', 'use cases', 'domain events', 'queues'],
  note: 'cooper, the manual\'s example application, as newt-monitor reads it from its code.',
}, {
  kicker: 'Un framework de backend para Bun',
  news: 'newt-monitor ya responde a Claude, por MCP',
  title: 'Backends que siguen limpios.',
  subtitle: 'Un monitor que lo ve todo.',
  lead: 'newt da a tu código una forma que aguanta al crecer: contextos delimitados, casos de uso, entidades que cuentan lo que pasó, eventos que nunca se pierden. newt-monitor te enseña esa forma funcionando en producción, con tus propias palabras, hasta la última consulta.',
  read: 'Leer el manual',
  monitor: 'Ver el monitor',
  shot: 'newt-monitor con la traza de una petición a cooper: cada caso de uso, consulta, transacción y worker',
  stats: ['contextos', 'módulos', 'casos de uso', 'eventos de dominio', 'colas'],
  note: 'cooper, la aplicación de ejemplo del manual, tal como newt-monitor la lee de su código.',
})
/** cooper as newt-monitor counts it, read from its code. */
const counts = [3, 25, 150, 28, 36]
</script>

<template>
  <!-- The hero holds still while the logotype flies into the nav (HeroLogo's runway), then scrolls away. -->
  <div class="runway">
    <section class="hero">
      <div class="l-container copy">
        <HeroLogo />
        <p class="kicker">
          {{ copy.kicker }}
          <a :href="withBase('/manual/46-asking-claude')">{{ copy.news }} →</a>
        </p>
        <h1>{{ copy.title }}<br><span>{{ copy.subtitle }}</span></h1>
        <p class="lead">{{ copy.lead }}</p>
        <div class="actions">
          <a class="l-btn primary" :href="withBase('/manual/00-how-to-read')">{{ copy.read }} <span class="arrow">→</span></a>
          <a class="l-btn ghost" href="#monitor">{{ copy.monitor }}</a>
          <code class="install"><span>$</span> bunx newt init</code>
        </div>
      </div>

      <div class="l-container">
        <div class="browser">
          <div class="bar"><span class="url">monitor · cooper · traces · POST /api/workspaces/:workspaceId/boards/:boardId/cards</span></div>
          <div class="screen"><Shot name="monitor-trace" :alt="copy.shot" eager /></div>
        </div>

        <ul class="stats">
          <li v-for="(count, index) in counts" :key="index">
            <strong><Counter :to="count" /></strong>
            <span>{{ copy.stats[index] }}</span>
          </li>
        </ul>
        <p class="stats-note">{{ copy.note }}</p>
      </div>
    </section>
    <div class="runway-space" />
  </div>
</template>

<style scoped>
.hero { position: sticky; top: var(--vp-nav-height); padding: clamp(56px, 9vw, 120px) 0 clamp(64px, 8vw, 104px); }
.copy > * { max-width: 980px; }
.runway-space { height: var(--newt-runway, 0px); }

.kicker { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; font-family: var(--vp-font-family-mono); font-size: 13px; color: var(--l-ink-3); }
.kicker a { color: var(--l-orange); border-bottom: 1px solid transparent; }
.kicker a:hover { border-bottom-color: currentColor; }

h1 { margin-top: 28px; font-size: clamp(40px, 6.6vw, 78px); line-height: 1.04; letter-spacing: -0.035em; font-weight: 650; color: var(--l-ink); text-wrap: balance; }
h1 span { color: var(--l-ink-3); }
.lead { max-width: 700px; margin-top: 28px; font-size: clamp(16.5px, 1.6vw, 19px); line-height: 1.7; color: var(--l-ink-2); text-wrap: pretty; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 36px; }
.install { margin-left: 8px; font-size: 13.5px; color: var(--l-ink-2); }
.install span { color: var(--l-ink-3); margin-right: 4px; }

.browser { margin-top: clamp(56px, 8vw, 88px); border-radius: 4px; overflow: hidden; background: var(--l-code-bg); border: 1px solid var(--l-border-strong); box-shadow: var(--l-shadow-big); }
.bar { display: flex; align-items: center; height: 36px; padding: 0 14px; background: var(--l-code-bar); border-bottom: 1px solid var(--l-code-border); }
.url { min-width: 0; color: var(--l-code-dim); font-size: 12px; font-family: var(--vp-font-family-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.screen { position: relative; max-height: min(60vw, 680px); overflow: hidden; }
.screen::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 22%; background: linear-gradient(transparent, var(--l-bg)); pointer-events: none; }

.stats { list-style: none; display: grid; grid-template-columns: repeat(5, 1fr); margin-top: clamp(40px, 6vw, 64px); border-top: 1px solid var(--l-border); border-bottom: 1px solid var(--l-border); }
.stats li { padding: 24px 8px; text-align: center; }
.stats li + li { border-left: 1px solid var(--l-border); }
.stats strong { display: block; font-size: clamp(28px, 3.4vw, 40px); font-weight: 600; letter-spacing: -0.03em; line-height: 1; color: var(--l-ink); font-variant-numeric: tabular-nums; }
.stats li > span { display: block; margin-top: 10px; font-size: 13px; color: var(--l-ink-3); }
.stats-note { margin-top: 12px; text-align: center; font-size: 12.5px; color: var(--l-ink-3); }

@media (max-width: 960px) {
  .stats { grid-template-columns: repeat(3, 1fr); }
  .stats li:nth-child(4) { border-left: 0; }
  .stats li:nth-child(n + 4) { border-top: 1px solid var(--l-border); }
}
@media (max-width: 560px) {
  .install { margin-left: 0; }
  .url { font-size: 10.5px; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .stats li:nth-child(odd) { border-left: 0; }
  .stats li:nth-child(4) { border-left: 1px solid var(--l-border); }
  .stats li:nth-child(n + 3) { border-top: 1px solid var(--l-border); }
}
</style>
