<script setup lang="ts">
import { withBase } from 'vitepress'
import { useCopy } from './i18n'

/** What every newt application gets, whatever it does: each with the detail that proves it, and its chapter. */
const details = [
  ['SQLite', 'Files', 'Postgres', 'MySQL'],
  ['time += DAY_MS', 'await base.schedules.tick()'],
  ['x-frame-options: DENY', 'content-security-policy: script-src \'sha256-…\'', '413 · 403 · 401'],
  ['route · group · router · use case', 'per person · per address · any key', 'memory · table · Redis'],
  ['Idempotency-Key: 7f3a', '→ 201, once'],
  ['Bun.serve', 'bun:sqlite', 'Bun.SQL', 'zod', 'kysely'],
]
const links = ['/manual/26-stores', '/manual/23-time', '/manual/27-security', '/manual/28-rate-limits', '/manual/24-idempotency', '/manual/01-why-newt']

const items = useCopy([
  { title: 'Stores you can swap', text: 'SQLite, plain files, Postgres and MySQL behind one port, proven by one contract suite. Start on a file, grow into a server, change nothing in your modules.' },
  { title: 'Time you can move', text: 'One clock per context drives timestamps, jobs and cron schedules. Tests move it instead of waiting.' },
  { title: 'Closed by default', text: 'Every route needs a session. Security headers, HSTS, a CSP with hashed scripts, body limits and an origin check, built in.' },
  { title: 'Rate limits where they belong', text: 'On a route, a group, a router or a use case; counted by person, by address or by any key you name; kept in memory, a table or Redis. Each shows up in its trace.' },
  { title: 'Idempotent where it matters', text: 'A POST that creates takes an Idempotency-Key, and a second send gets the first answer. A job keys what must happen once by its event\'s id.' },
  { title: 'Bun, and only Bun', text: 'Bun.serve, bun:sqlite and Bun.SQL underneath; Zod for every schema; Kysely when a query needs SQL. No Express, no ORM, no build step to configure.' },
], [
  { title: 'Almacenes intercambiables', text: 'SQLite, ficheros, Postgres y MySQL detrás de un mismo puerto, probados por una misma batería de contrato. Empieza en un fichero, crece a un servidor, sin tocar tus módulos.' },
  { title: 'Un tiempo que se puede mover', text: 'Un reloj por contexto mueve las fechas, los jobs y las tareas programadas. Los tests lo adelantan en vez de esperar.' },
  { title: 'Cerrado por defecto', text: 'Toda ruta necesita sesión. Cabeceras de seguridad, HSTS, una CSP con scripts por hash, límites de cuerpo y una comprobación de origen, de serie.' },
  { title: 'Rate limits donde tocan', text: 'En una ruta, un grupo, un router o un caso de uso; contados por persona, por dirección o por la clave que quieras; guardados en memoria, una tabla o Redis. Cada uno aparece en su traza.' },
  { title: 'Idempotente donde importa', text: 'Un POST que crea lleva una Idempotency-Key, y un segundo envío recibe la primera respuesta. Un job identifica lo que debe pasar una sola vez por el id de su evento.' },
  { title: 'Bun, y solo Bun', text: 'Bun.serve, bun:sqlite y Bun.SQL por debajo; Zod para cada esquema; Kysely cuando una consulta necesita SQL. Sin Express, sin ORM, sin build que configurar.' },
])
</script>

<template>
  <div class="specs">
    <a v-for="(item, index) in items" :key="index" class="spec" :href="withBase(links[index]!)">
      <span class="n">{{ String(index + 1).padStart(2, '0') }}</span>
      <h3>{{ item.title }}</h3>
      <p>{{ item.text }}</p>
      <div class="detail"><code v-for="each in details[index]" :key="each">{{ each }}</code></div>
    </a>
  </div>
</template>

<style scoped>
.specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--l-border); border-left: 1px solid var(--l-border); }
.spec { display: flex; flex-direction: column; padding: 28px 28px 26px; border-right: 1px solid var(--l-border); border-bottom: 1px solid var(--l-border); transition: background .25s ease; }
.spec:hover { background: var(--l-panel); }
.n { font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--l-orange); }
.spec h3 { margin-top: 12px; font-size: 17px; font-weight: 650; color: var(--l-ink); }
.spec p { margin-top: 8px; font-size: 14.5px; line-height: 1.65; color: var(--l-ink-2); }
.detail { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 20px; }
.detail code { padding: 3px 7px; border-radius: 2px; font-size: 11.5px; color: var(--l-ink-2); background: var(--l-bg-2); border: 1px solid var(--l-border); }

@media (max-width: 960px) { .specs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .specs { grid-template-columns: minmax(0, 1fr); } .spec { padding: 24px 20px; } }
</style>
