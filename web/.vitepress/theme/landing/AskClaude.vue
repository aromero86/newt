<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCopy } from './i18n'
import { onInView, reducedMotion, useTimers } from './motion'

/** A question to Claude, the monitor's tools it calls, and its answer: from what the monitor showed of cooper. */
const copy = useCopy({
  eyebrow: 'It answers Claude, too', title: 'Ask production', rest: 'in plain words.',
  lead: 'newt-monitor is an MCP server behind OAuth. Connect Claude, and it can read what the monitor reads: structure, metrics, traces, queues, dead jobs, deploys. It can look; it cannot touch.',
  note: 'tools, all of them read-only. Never a payload, never a row of your data.',
  you: 'You',
  question: 'Anything wrong with cooper\'s queues in the last hour?',
  calls: ['cooper · 1 hour', 'cooper · boards'],
  answer: 'One job is dead. In boards, card.notifyAssignee.on.card.created ran out of its 5 attempts: MailNotSent, the mail server at smtp.cooper.dev:587 refused the connection. Everything else flowed: 12,867 jobs in and 12,867 out, none waiting, p90 wait 1 ms. Once the mail server is back, retry it from cooper\'s backoffice.',
}, {
  eyebrow: 'También responde a Claude', title: 'Pregunta a producción', rest: 'con palabras normales.',
  lead: 'newt-monitor es un servidor MCP detrás de OAuth. Conecta Claude, y podrá leer lo que lee el monitor: estructura, métricas, trazas, colas, jobs muertos, despliegues. Puede mirar; no puede tocar.',
  note: 'herramientas, todas de solo lectura. Nunca un payload, nunca una fila de tus datos.',
  you: 'Tú',
  question: '¿Algo raro en las colas de cooper en la última hora?',
  calls: ['cooper · 1 hora', 'cooper · boards'],
  answer: 'Hay un job muerto. En boards, card.notifyAssignee.on.card.created agotó sus 5 intentos: MailNotSent, el servidor de correo en smtp.cooper.dev:587 rechazó la conexión. Todo lo demás fluyó: 12.867 jobs entraron y 12.867 salieron, ninguno esperando, p90 de espera de 1 ms. Cuando el servidor de correo vuelva, reinténtalo desde el backoffice de cooper.',
})
const calls = ['queues', 'dead_jobs']
const question = computed(() => copy.value.question)
const words = computed(() => copy.value.answer.split(' '))

const typed = ref(0)
const called = ref(0)
const said = ref(0)
const timers = useTimers()
let started = false

function run() {
  if (reducedMotion()) { typed.value = question.value.length; called.value = calls.length; said.value = words.value.length; return }
  const type = () => { if (typed.value < question.value.length) { typed.value++; timers.after(28, type) } else timers.after(600, call) }
  const call = () => { if (called.value < calls.length) { called.value++; timers.after(900, call) } else timers.after(500, say) }
  const say = () => { if (said.value < words.value.length) { said.value++; timers.after(45, say) } }
  type()
}
const root = ref<HTMLElement>()
onInView(root, () => { if (!started) { started = true; run() } }, { threshold: 0.4, once: true })

/** Every tool the monitor's MCP server gives Claude: reading only. */
const tools = ['list_apps', 'get_structure', 'use_case_totals', 'use_case_series', 'errors_totals', 'error_codes', 'event_totals', 'list_traces', 'get_trace', 'queues', 'dead_jobs', 'system_and_instances', 'system_series', 'list_deployments', 'list_versions']
</script>

<template>
  <div ref="root" class="ask">
    <div class="copy">
      <p class="l-eyebrow"><b>✳</b> {{ copy.eyebrow }}</p>
      <h2 class="l-h2">{{ copy.title }} <span class="l-ink">{{ copy.rest }}</span></h2>
      <p class="l-lead">{{ copy.lead }}</p>
      <div class="tools">
        <code v-for="(tool, index) in tools" :key="tool" :style="{ '--i': index }">{{ tool }}</code>
      </div>
      <p class="tools-note">{{ tools.length }} {{ copy.note }}</p>
    </div>

    <div class="chat l-glass">
      <div class="msg user">
        <span class="who">{{ copy.you }}</span>
        <p>{{ question.slice(0, typed) }}<i v-if="typed < question.length" class="caret" /></p>
      </div>
      <TransitionGroup name="call" tag="div" class="calls">
        <div v-for="(call, index) in calls.slice(0, called)" :key="call" class="call">
          <span class="spin" />
          <span class="mcp">newt-monitor</span>
          <code>{{ call }}</code>
          <em>{{ copy.calls[index] }}</em>
          <span class="done">✓</span>
        </div>
      </TransitionGroup>
      <div v-if="said > 0" class="msg claude">
        <span class="who"><b>✳</b> Claude</span>
        <p>{{ words.slice(0, said).join(' ') }}<i v-if="said < words.length" class="caret" /></p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ask { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(32px, 6vw, 80px); align-items: center; }
.tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 32px; }
.tools code { padding: 5px 9px; border-radius: 2px; font-size: 12px; color: var(--l-ink-2); background: var(--l-panel); border: 1px solid var(--l-border); transition: all .2s ease; }
.tools code:hover { color: var(--l-green-ink); border-color: var(--l-green); }
.tools-note { margin-top: 14px; font-size: 13.5px; color: var(--l-ink-3); }

.chat { min-height: 420px; padding: 24px; border-radius: 4px; display: flex; flex-direction: column; gap: 16px; }
.msg { max-width: 92%; padding: 14px 18px; border-radius: 4px; font-size: 15px; line-height: 1.6; }
.msg p { color: inherit; }
.who { display: block; margin-bottom: 4px; font-size: 12px; font-weight: 700; letter-spacing: .04em; opacity: .7; }
.who b { color: var(--l-orange); }
.user { align-self: flex-end; color: var(--l-on-accent); background: var(--l-green); border-bottom-right-radius: 0; }
.claude { align-self: flex-start; color: var(--l-ink); background: var(--l-panel-solid); border: 1px solid var(--l-border); border-bottom-left-radius: 0; animation: in .4s ease; }
.calls { display: grid; gap: 8px; }
.call { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 4px; font-size: 13px; background: var(--l-bg-2); border: 1px dashed var(--l-border-strong); }
.call .mcp { font-size: 11px; font-weight: 700; color: var(--l-ink-3); text-transform: uppercase; letter-spacing: .06em; }
.call code { font-size: 12.5px; color: var(--l-orange); font-weight: 700; }
.call em { font-style: normal; font-size: 12px; color: var(--l-ink-3); }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--l-border-strong); border-top-color: var(--l-green); animation: spin .7s linear 2; }
.done { margin-left: auto; color: var(--l-green-ink); font-weight: 800; animation: in .3s 1.2s both; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes in { from { opacity: 0; transform: translateY(6px); } }
.caret { display: inline-block; width: 2px; height: 1em; margin-left: 2px; vertical-align: -2px; background: currentColor; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.call-enter-active { transition: all .35s ease; }
.call-enter-from { opacity: 0; transform: translateY(6px); }

@media (max-width: 1000px) { .ask { grid-template-columns: minmax(0, 1fr); } .chat { min-height: 0; } }
</style>
