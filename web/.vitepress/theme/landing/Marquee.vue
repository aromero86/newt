<script setup lang="ts">
/** What newt is made of, in two bands that never stop. */
const rows = [
  ['Bounded contexts', 'Modules', 'Use cases', 'Entities', 'Domain events', 'Transactional outbox', 'Workers', 'Schedules', 'Scopes', 'Repositories', 'Value objects', 'Pages'],
  ['Rate limits', 'Idempotency keys', 'Security headers', 'CSP with hashed scripts', 'Sessions', 'OAuth', 'MCP', 'SQLite', 'Postgres', 'MySQL', 'Redis', 'OpenTelemetry'],
]
</script>

<template>
  <div class="marquee" aria-label="What newt is made of">
    <div v-for="(row, index) in rows" :key="index" class="row" :class="{ reverse: index % 2 }">
      <div class="track">
        <span v-for="(item, position) in [...row, ...row]" :key="position" :aria-hidden="position >= row.length" class="item"><i />{{ item }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marquee { display: grid; gap: 14px; padding: 8px 0 clamp(40px, 6vw, 72px); mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }
.row { overflow: hidden; }
.track { display: flex; gap: 14px; width: max-content; animation: scroll 60s linear infinite; }
.row.reverse .track { animation-direction: reverse; animation-duration: 70s; }
.marquee:hover .track { animation-play-state: paused; }
@keyframes scroll { to { transform: translateX(calc(-50% - 7px)); } }
.item { display: inline-flex; align-items: center; gap: 10px; height: 42px; padding: 0 18px; border-radius: 999px; font-size: 14.5px; font-weight: 600; color: var(--l-ink-2); background: var(--l-panel); border: 1px solid var(--l-border); white-space: nowrap; }
.item i { width: 7px; height: 7px; border-radius: 2px; transform: rotate(45deg); background: linear-gradient(135deg, var(--l-green), var(--l-orange)); }
</style>
