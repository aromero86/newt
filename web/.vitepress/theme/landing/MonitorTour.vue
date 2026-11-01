<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import Shot from './Shot.vue'

/** What newt-monitor shows of an application, one tab each, with the chapter that explains it. */
const tabs = [
  { key: 'overview', label: 'Overview', shot: 'monitor-overview', title: 'The whole application, at a glance', text: 'Contexts, modules, use cases and events it is made of; its instances alive, disk, memory and event loop; every use case\'s calls, errors, failures and times, from the last hour to the last year.', link: '/book/43-metrics' },
  { key: 'structure', label: 'Structure', shot: 'monitor-graph', title: 'What uses what, drawn from the code', text: 'Each module with what it uses and what uses it, across contexts, its reactions included. Every use case says whether it writes only to its own module and whether it runs again on a conflict.', link: '/book/42-structure' },
  { key: 'use-case', label: 'Use cases', shot: 'monitor-use-case', title: 'Every use case, measured', text: 'Calls, errors by code, failures nobody expected, conflicts that ran it again, p50 and p90, by workspace and by person. A slow one shows you why.', link: '/book/43-metrics' },
  { key: 'traces', label: 'Traces', shot: 'monitor-trace', title: 'One request, down to the last query', text: 'A request, a use case it called in another context, every query with its criteria and rows, the transaction, the event told, and the workers that ran after it.', link: '/book/44-traces' },
  { key: 'queues', label: 'Queues', shot: 'monitor-queues', title: 'The outbox, live', text: 'Every queue: what waits, what runs, how long jobs wait, what died. The depth over time tells you a worker fell behind before your users do.', link: '/book/45-queues' },
  { key: 'job', label: 'Dead jobs', shot: 'monitor-job', title: 'What died, and why', text: 'A job that failed every attempt keeps its event and its last error. Read what it was about and why it failed, fix the cause, and let your application put it back in its queue: in cooper, the backoffice does it with one button.', link: '/book/45-queues' },
  { key: 'system', label: 'System', shot: 'monitor-system', title: 'Its instances, and their machines', text: 'CPU, memory, event loop delay and disk of every instance, and how many were alive, minute by minute, across deploys.', link: '/book/43-metrics' },
]
const current = ref(tabs[0]!.key)
const tab = computed(() => tabs.find(each => each.key === current.value)!)
</script>

<template>
  <div class="tour">
    <div class="tabs" role="tablist" aria-label="What newt-monitor shows">
      <button v-for="each in tabs" :key="each.key" role="tab" type="button" :aria-selected="each.key === current" :class="{ on: each.key === current }" @click="current = each.key">
        {{ each.label }}
      </button>
    </div>
    <div class="panel" role="tabpanel">
      <div class="copy">
        <h3>{{ tab.title }}</h3>
        <p>{{ tab.text }}</p>
        <a :href="withBase(tab.link)">In the book →</a>
      </div>
      <Shot :key="tab.shot" class="shot" :name="tab.shot" :alt="tab.title" />
    </div>
  </div>
</template>

<style scoped>
.tabs { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 28px; }
.tabs button { padding: 8px 16px; border-radius: 999px; border: 1px solid var(--vp-c-divider); font-size: 14px; font-weight: 600; color: var(--vp-c-text-2); transition: all .2s ease; }
.tabs button:hover { color: var(--vp-c-text-1); border-color: var(--vp-c-brand-2); }
.tabs button.on { background: var(--vp-c-brand-2); border-color: var(--vp-c-brand-2); color: #fff; }
.panel { display: grid; grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.3fr); gap: 40px; align-items: center; }
.copy h3 { font-size: 24px; line-height: 1.25; margin-bottom: 12px; }
.copy p { color: var(--vp-c-text-2); line-height: 1.65; }
.copy a { display: inline-block; margin-top: 16px; font-weight: 600; color: var(--vp-c-brand-1); text-decoration: none; }
.shot { animation: fade .45s ease; }
@keyframes fade { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
@media (max-width: 960px) { .panel { grid-template-columns: 1fr; } }
</style>
