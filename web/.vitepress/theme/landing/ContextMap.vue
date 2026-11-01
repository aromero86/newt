<script setup lang="ts">
import { ref } from 'vue'

/** cooper's contexts and their modules, and what each context uses: as its lint says (contexts.uses). */
const contexts = [
  { name: 'auth', x: 40, y: 40, modules: ['user', 'session', 'tenant', 'access', 'invitation', 'product', 'oauth-client', 'oauth-grant', 'token'], note: 'People, workspaces and who may enter each, sign-in, and an OAuth server. Uses nobody.' },
  { name: 'boards', x: 330, y: 40, modules: ['workspace', 'member', 'board', 'column', 'card', 'activity'], note: 'Boards, columns and cards of each workspace. Asks auth who may enter, and hears when a workspace comes and goes.' },
  { name: 'backoffice', x: 185, y: 330, modules: ['staff', 'user', 'workspace', 'metric', 'job'], note: 'What the staff see across the others. Reads auth and boards, never writes to them.' },
]
const active = ref<string | null>(null)
</script>

<template>
  <div class="map">
    <svg viewBox="0 0 600 500" role="img" aria-label="cooper's three bounded contexts, their modules, and which context uses which">
      <defs>
        <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" class="arrow-head" />
        </marker>
      </defs>
      <!-- uses: boards → auth, backoffice → auth, backoffice → boards -->
      <path class="edge" :class="{ lit: active === 'boards' || active === 'auth' }" d="M330,140 C 300,140 300,140 270,140" marker-end="url(#map-arrow)" />
      <path class="edge" :class="{ lit: active === 'backoffice' || active === 'auth' }" d="M230,330 C 200,300 160,300 155,264" marker-end="url(#map-arrow)" />
      <path class="edge" :class="{ lit: active === 'backoffice' || active === 'boards' }" d="M370,330 C 400,280 440,250 445,196" marker-end="url(#map-arrow)" />
      <g v-for="context in contexts" :key="context.name" class="context" :class="{ dim: active && active !== context.name }"
         @mouseenter="active = context.name" @mouseleave="active = null" @focus="active = context.name" @blur="active = null" tabindex="0">
        <rect :x="context.x" :y="context.y" width="230" :height="48 + Math.ceil(context.modules.length / 2) * 34" rx="16" class="box" />
        <text :x="context.x + 18" :y="context.y + 32" class="name">{{ context.name }}</text>
        <g v-for="(module, index) in context.modules" :key="module">
          <rect :x="context.x + 14 + (index % 2) * 104" :y="context.y + 48 + Math.floor(index / 2) * 34" width="96" height="26" rx="8" class="module" />
          <text :x="context.x + 62 + (index % 2) * 104" :y="context.y + 65 + Math.floor(index / 2) * 34" class="module-name">{{ module }}</text>
        </g>
      </g>
    </svg>
    <p class="note">{{ contexts.find(context => context.name === active)?.note ?? 'Hover a context: each has its own database, and the arrows are the only ways in.' }}</p>
  </div>
</template>

<style scoped>
.map { width: 100%; }
svg { width: 100%; height: auto; display: block; }
.box { fill: var(--vp-c-bg-soft); stroke: var(--vp-c-divider); stroke-width: 1.5; transition: stroke .3s ease; }
.context:hover .box, .context:focus .box { stroke: var(--vp-c-brand-2); }
.context { transition: opacity .3s ease; outline: none; cursor: default; }
.context.dim { opacity: .35; }
.name { font-size: 18px; font-weight: 700; fill: var(--vp-c-text-1); }
.module { fill: var(--newt-green-soft); stroke: color-mix(in srgb, var(--vp-c-brand-2) 40%, transparent); }
.module-name { font-size: 11.5px; font-family: var(--vp-font-family-mono); fill: var(--vp-c-text-1); text-anchor: middle; }
.edge { fill: none; stroke: var(--vp-c-text-3); stroke-width: 2; stroke-dasharray: 6 6; animation: dash 1.2s linear infinite; transition: stroke .3s ease; }
.edge.lit { stroke: var(--newt-orange-2); }
.arrow-head { fill: var(--vp-c-text-3); }
@keyframes dash { to { stroke-dashoffset: -12; } }
@media (prefers-reduced-motion: reduce) { .edge { animation: none; } }
.note { margin-top: 12px; text-align: center; color: var(--vp-c-text-2); font-size: 15px; min-height: 48px; }
</style>
