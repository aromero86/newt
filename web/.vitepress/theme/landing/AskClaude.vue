<script setup lang="ts">
import { ref } from 'vue'
import { onInView, reducedMotion, useTimers } from './motion'

/** A question to Claude, the monitor's tools it calls, and its answer: from what the monitor showed of cooper. */
const question = 'Anything wrong with cooper\'s queues in the last hour?'
const calls = [
  { tool: 'queues', args: 'cooper · 1 hour' },
  { tool: 'dead_jobs', args: 'cooper · boards' },
]
const answer = 'One job is dead. In boards, card.notifyAssignee.on.card.created ran out of its 5 attempts: MailNotSent, the mail server at smtp.cooper.dev:587 refused the connection. Everything else flowed: 12,867 jobs in and 12,867 out, none waiting, p90 wait 1 ms. Once the mail server is back, retry it from cooper\'s backoffice.'
const words = answer.split(' ')

const typed = ref(0)
const called = ref(0)
const said = ref(0)
const timers = useTimers()
let started = false

function run() {
  if (reducedMotion()) { typed.value = question.length; called.value = calls.length; said.value = words.length; return }
  const type = () => { if (typed.value < question.length) { typed.value++; timers.after(28, type) } else timers.after(600, call) }
  const call = () => { if (called.value < calls.length) { called.value++; timers.after(900, call) } else timers.after(500, say) }
  const say = () => { if (said.value < words.length) { said.value++; timers.after(45, say) } }
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
      <p class="l-eyebrow">It answers Claude, too</p>
      <h2 class="l-h2">Ask production <span class="l-ink">in plain words.</span></h2>
      <p class="l-lead">
        newt-monitor is an MCP server behind OAuth. Connect Claude, and it can read what the monitor reads: structure,
        metrics, traces, queues, dead jobs, deploys. It can look; it cannot touch.
      </p>
      <div class="tools">
        <code v-for="(tool, index) in tools" :key="tool" :style="{ '--i': index }">{{ tool }}</code>
      </div>
      <p class="tools-note">{{ tools.length }} tools, all of them read-only. Never a payload, never a row of your data.</p>
    </div>

    <div class="chat l-glass">
      <div class="msg user">
        <span class="who">You</span>
        <p>{{ question.slice(0, typed) }}<i v-if="typed < question.length" class="caret" /></p>
      </div>
      <TransitionGroup name="call" tag="div" class="calls">
        <div v-for="call in calls.slice(0, called)" :key="call.tool" class="call">
          <span class="spin" />
          <span class="mcp">newt-monitor</span>
          <code>{{ call.tool }}</code>
          <em>{{ call.args }}</em>
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
.tools code { padding: 6px 10px; border-radius: 4px; font-size: 12px; color: var(--l-ink-2); background: var(--l-panel); border: 1px solid var(--l-border); transition: all .2s ease; }
.tools code:hover { color: var(--l-green-ink); border-color: var(--l-green); transform: translateY(-2px); }
.tools-note { margin-top: 14px; font-size: 13.5px; color: var(--l-ink-3); }

.chat { min-height: 420px; padding: 24px; border-radius: 6px; display: flex; flex-direction: column; gap: 16px; }
.msg { max-width: 92%; padding: 14px 18px; border-radius: 6px; font-size: 15px; line-height: 1.6; }
.msg p { color: inherit; }
.who { display: block; margin-bottom: 4px; font-size: 12px; font-weight: 700; letter-spacing: .04em; opacity: .7; }
.who b { color: var(--l-orange); }
.user { align-self: flex-end; color: var(--l-on-accent); background: linear-gradient(180deg, var(--l-green), var(--l-green)); border-bottom-right-radius: 2px; box-shadow: 0 12px 30px -12px var(--l-glow-green); }
.claude { align-self: flex-start; color: var(--l-ink); background: var(--l-panel-solid); border: 1px solid var(--l-border); border-bottom-left-radius: 2px; animation: in .4s ease; }
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
.call-enter-active { transition: all .4s cubic-bezier(.3,1.4,.5,1); }
.call-enter-from { opacity: 0; transform: translateY(10px) scale(.97); }

@media (max-width: 1000px) { .ask { grid-template-columns: minmax(0, 1fr); } .chat { min-height: 0; } }
</style>
