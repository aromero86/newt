<script setup lang="ts">
import { computed, ref } from 'vue'

/** cooper's contexts, their modules, and what each uses: as its lint says (contexts.uses). */
const contexts = [
  { name: 'auth', x: 0, y: 24, modules: ['user', 'session', 'tenant', 'access', 'invitation', 'product', 'oauth-client', 'oauth-grant', 'token'], note: 'People, workspaces and who may enter each, sign-in, and an OAuth server of its own. It uses no other context.' },
  { name: 'boards', x: 372, y: 24, modules: ['workspace', 'member', 'board', 'column', 'card', 'activity'], note: 'Boards, columns and cards of each workspace. It asks auth who may enter, and hears when a workspace comes and goes.' },
  { name: 'backoffice', x: 186, y: 300, modules: ['staff', 'user', 'workspace', 'metric', 'job'], note: 'What cooper\'s staff see across the others. It reads auth and boards and hears their events, and never writes to them.' },
]
const W = 268
const heightOf = (count: number) => 66 + Math.ceil(count / 2) * 32
const edges = [
  { from: 'boards', to: 'auth', d: 'M372,96 C340,96 300,96 272,96', label: 'access.check', lx: 320, ly: 84 },
  { from: 'backoffice', to: 'auth', d: 'M226,300 C226,276 134,282 134,252', label: 'hears tenant.created', lx: 118, ly: 284 },
  { from: 'backoffice', to: 'boards', d: 'M414,300 C414,256 506,236 506,196', label: 'hears card.created', lx: 500, ly: 268 },
]
const forbidden = 'M180,22 C200,-30 440,-30 460,20'

const active = ref<string | null>(null)
const tried = ref(false)
const note = computed(() => contexts.find(each => each.name === active.value)?.note
  ?? 'Hover a context. Each has its own database; the arrows are the only ways in, and the particles go where the dependency goes.')
const lit = (edge: typeof edges[number]) => active.value === edge.from || active.value === edge.to
</script>

<template>
  <div class="map">
    <div class="canvas l-glass">
      <svg viewBox="0 -44 640 520" role="img" aria-label="cooper's three bounded contexts, their modules, and which context uses which">
        <defs>
          <marker id="ctx-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" class="head" />
          </marker>
          <linearGradient id="ctx-card" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" class="stop-a" />
            <stop offset="1" class="stop-b" />
          </linearGradient>
        </defs>

        <g v-for="edge in edges" :key="edge.d" class="edge" :class="{ lit: lit(edge), dim: active && !lit(edge) }">
          <path :d="edge.d" marker-end="url(#ctx-arrow)" />
          <circle r="3.5" class="particle"><animateMotion :path="edge.d" dur="2.2s" repeatCount="indefinite" /></circle>
          <circle r="3.5" class="particle"><animateMotion :path="edge.d" dur="2.2s" begin="1.1s" repeatCount="indefinite" /></circle>
          <text :x="edge.lx" :y="edge.ly" class="edge-label">{{ edge.label }}</text>
        </g>

        <g v-if="tried" class="forbidden">
          <path :d="forbidden" />
          <circle cx="320" cy="-18" r="13" />
          <text x="320" y="-13">✕</text>
        </g>

        <g v-for="context in contexts" :key="context.name" class="context" :class="[context.name, { dim: active && active !== context.name }]" tabindex="0"
           @mouseenter="active = context.name" @mouseleave="active = null" @focus="active = context.name" @blur="active = null">
          <rect :x="context.x" :y="context.y" :width="W" :height="heightOf(context.modules.length)" rx="6" class="box" />
          <rect :x="context.x" :y="context.y" :width="W" height="4" rx="3" class="accent" />
          <text :x="context.x + 18" :y="context.y + 34" class="name">{{ context.name }}</text>
          <text :x="context.x + 20 + context.name.length * 11" :y="context.y + 34" class="count">{{ context.modules.length }} modules</text>
          <g class="db" :transform="`translate(${context.x + W - 38}, ${context.y + 16})`">
            <ellipse cx="11" cy="4" rx="6" ry="4" />
            <path d="M0,4 V18 A11,4 0 0 0 22,18 V4" />
            <path d="M0,11 A11,4 0 0 0 22,11" class="ring" />
          </g>
          <g v-for="(module, index) in context.modules" :key="module">
            <rect :x="context.x + 14 + (index % 2) * 124" :y="context.y + 52 + Math.floor(index / 2) * 32" width="116" height="25" rx="6" class="module" />
            <text :x="context.x + 72 + (index % 2) * 124" :y="context.y + 69 + Math.floor(index / 2) * 32" class="module-name">{{ module }}</text>
          </g>
        </g>
      </svg>
      <p class="note">{{ note }}</p>
    </div>

    <div class="try">
      <button type="button" class="l-btn ghost" :class="{ on: tried }" @click="tried = !tried">
        {{ tried ? 'Undo it' : 'Now make auth import boards' }}
      </button>
      <Transition name="toast">
        <div v-if="tried" class="toast l-window">
          <div class="l-window-bar"><i /><i /><i /><em>bun run lint</em></div>
          <pre><code><span class="file">auth/modules/access/access.module.ts</span>
  <span class="err">error</span>  '../../../boards/modules/card/card.module' is the
         context boards's, and auth uses no other context:
         contexts use only the ones they say, never in a cycle
         <span class="rule">newt/context-boundaries</span>

<span class="err">✕ 1 problem</span></code></pre>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.canvas { padding: 18px 18px 22px; border-radius: 6px; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
.stop-a { stop-color: var(--l-panel-solid); }
.stop-b { stop-color: var(--l-bg-2); }
.box { fill: url(#ctx-card); stroke: var(--l-border-strong); stroke-width: 1.2; transition: stroke .3s ease, filter .3s ease; }
.context { transition: opacity .35s ease, transform .35s ease; outline: none; cursor: default; transform-box: fill-box; }
.context.dim { opacity: .28; }
.context:hover .box, .context:focus .box { stroke-width: 2; }
.context.auth { --c: var(--l-violet); }
.context.boards { --c: var(--l-blue); }
.context.backoffice { --c: var(--l-orange); }
.context:hover .box, .context:focus .box { stroke: var(--c); filter: drop-shadow(0 10px 24px color-mix(in srgb, var(--c) 35%, transparent)); }
.accent { fill: var(--c); }
.name { font-size: 19px; font-weight: 800; fill: var(--l-ink); letter-spacing: -0.02em; }
.count { font-size: 11.5px; fill: var(--l-ink-3); }
.db ellipse, .db path { fill: color-mix(in srgb, var(--c) 16%, transparent); stroke: var(--c); stroke-width: 1.3; }
.db .ring { fill: none; }
.module { fill: color-mix(in srgb, var(--c) 9%, transparent); stroke: color-mix(in srgb, var(--c) 32%, transparent); }
.module-name { font-size: 11.5px; font-family: var(--vp-font-family-mono); fill: var(--l-ink); text-anchor: middle; }

.edge path { fill: none; stroke: var(--l-ink-3); stroke-width: 2; stroke-dasharray: 5 6; animation: dash 1s linear infinite; transition: stroke .3s ease; }
.edge.lit path { stroke: var(--l-green); }
.edge.dim { opacity: .25; }
.head { fill: var(--l-ink-3); }
.particle { fill: var(--l-green); filter: drop-shadow(0 0 4px var(--l-green)); }
.edge-label { font-size: 11px; font-family: var(--vp-font-family-mono); fill: var(--l-ink-2); text-anchor: middle; paint-order: stroke; stroke: var(--l-bg); stroke-width: 4px; }
@keyframes dash { to { stroke-dashoffset: -11; } }
.forbidden path { fill: none; stroke: var(--l-red); stroke-width: 2.4; stroke-dasharray: 7 6; animation: dash 1s linear infinite; }
.forbidden circle { fill: var(--l-red); filter: drop-shadow(0 0 8px var(--l-red)); animation: pop .4s cubic-bezier(.3,1.6,.5,1); transform-origin: 320px -18px; }
.forbidden text { font-size: 14px; font-weight: 800; fill: var(--l-on-accent); text-anchor: middle; }
@keyframes pop { from { transform: scale(0); } }
.note { min-height: 48px; margin-top: 10px; text-align: center; font-size: 15px; line-height: 1.55; color: var(--l-ink-2); }

.try { margin-top: 18px; }
.try .l-btn.on { border-color: var(--l-red); color: var(--l-red); }
.toast { margin-top: 14px; }
.toast pre { font-size: 12px; line-height: 1.7; }
.file { color: var(--l-code-ink); text-decoration: underline; text-underline-offset: 3px; }
.err { color: var(--l-red); font-weight: 700; }
.rule { color: var(--l-code-dim); }
.toast-enter-active, .toast-leave-active { transition: opacity .35s ease, transform .35s cubic-bezier(.3,1.4,.5,1); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px) scale(.98); }
</style>
