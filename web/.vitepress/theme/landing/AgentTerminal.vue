<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCopy, useLang } from './i18n'
import { onInView, reducedMotion, useTimers } from './motion'

/** An agent at work in a newt application: what the CLI writes, and what newt says when a rule breaks. */
const english: { kind: 'cmd' | 'out' | 'ok' | 'bad' | 'gap', text: string }[] = [
  { kind: 'cmd', text: 'bunx newt-kit init' },
  { kind: 'out', text: 'wrote    AGENTS.md' },
  { kind: 'out', text: 'wrote    CLAUDE.md' },
  { kind: 'out', text: 'wrote    eslint.config.js' },
  { kind: 'gap', text: '' },
  { kind: 'cmd', text: 'bunx newt-kit add module contexts/boards label' },
  { kind: 'out', text: 'wrote    contexts/boards/modules/label/label.schema.ts' },
  { kind: 'out', text: 'wrote    contexts/boards/modules/label/label.module.ts' },
  { kind: 'out', text: 'wrote    contexts/boards/modules/label/…' },
  { kind: 'gap', text: '' },
  { kind: 'cmd', text: 'bun test' },
  { kind: 'bad', text: '[write rule] label.attach writes to boards.card outside a worker: write it from a worker reacting to an event, or list it in its writesTo' },
  { kind: 'gap', text: '' },
  { kind: 'cmd', text: '# the agent moves the write to a worker on label.attached' },
  { kind: 'cmd', text: 'bun test && bun run lint' },
  { kind: 'ok', text: '✓ tests pass · ✓ the lint has nothing to say' },
]
const lang = useLang()
const lines = computed(() => lang.value === 'es'
  ? english.map(line => line.text.startsWith('# the agent') ? { ...line, text: '# el agente mueve la escritura a un worker sobre label.attached' } : line)
  : english)
const shown = ref(0)
const chars = ref(0)
const timers = useTimers()

function step() {
  const line = lines.value[shown.value]
  if (!line) return
  if (line.kind === 'cmd' && chars.value < line.text.length) {
    chars.value++
    timers.after(22, step)
    return
  }
  shown.value++
  chars.value = 0
  const next = lines.value[shown.value]
  timers.after(!next ? 0 : next.kind === 'cmd' ? 500 : line.kind === 'cmd' ? 380 : 130, step)
}
const root = ref<HTMLElement>()
onInView(root, () => {
  if (shown.value) return
  if (reducedMotion()) { shown.value = lines.value.length; return }
  step()
}, { threshold: 0.4, once: true })

/** The three nets under every change, and what each catches. */
const englishNets = [
  { name: 'Types', command: 'bun check', catches: 'A field the schema lacks, a dependency nobody handed over, a use case answering the wrong shape.' },
  { name: 'The lint', command: 'newt-kit-eslint', catches: 'A file outside a module\'s anatomy, an import across a boundary, a queue named wrong.' },
  { name: 'Runtime rules', command: 'bun test', catches: 'A write into another module from a request, a save that guards nothing, an event without a change.' },
]
const nets = useCopy(englishNets, [
  { name: 'Tipos', catches: 'Un campo que el esquema no tiene, una dependencia que nadie entregó, un caso de uso que responde con la forma equivocada.' },
  { name: 'El lint', catches: 'Un fichero fuera de la anatomía de un módulo, un import que cruza una frontera, una cola mal nombrada.' },
  { name: 'Reglas en ejecución', catches: 'Una escritura en otro módulo desde una petición, un guardado que no protege nada, un evento sin cambio.' },
])
const copy = useCopy({
  eyebrow: 'Coding agents', title: 'Rails your AI', rest: 'can\'t jump.',
  lead: 'Structure is what makes an agent useful. newt ships its rules in an AGENTS.md versioned with the package, writes modules the lint already accepts, and checks every change three ways, each saying what to do instead.',
}, {
  eyebrow: 'Agentes de código', title: 'Raíles que tu IA', rest: 'no puede saltarse.',
  lead: 'La estructura es lo que hace útil a un agente. newt trae sus reglas en un AGENTS.md versionado con el paquete, genera módulos que el lint ya acepta, y comprueba cada cambio de tres maneras, cada una diciendo qué hacer en su lugar.',
})
</script>

<template>
  <div ref="root" class="agents">
    <div class="l-window term">
      <div class="l-window-bar"><i /><i /><i /><em>claude · ~/cooper</em></div>
      <pre><code><template v-for="(line, index) in lines.slice(0, shown + 1)" :key="index"><span v-if="line.kind === 'cmd'" class="cmd"><span class="prompt">$</span> {{ index < shown ? line.text : line.text.slice(0, chars) }}<i v-if="index === shown" class="caret" /></span><span v-else-if="index < shown" :class="line.kind">{{ line.text }}</span>
</template></code></pre>
    </div>

    <div class="copy">
      <p class="l-eyebrow"><b>06</b> {{ copy.eyebrow }}</p>
      <h2 class="l-h2">{{ copy.title }} <span class="l-ink">{{ copy.rest }}</span></h2>
      <p class="l-lead">{{ copy.lead }}</p>
      <ol class="nets">
        <li v-for="(net, index) in nets" :key="net.name" :style="{ '--i': index }">
          <span class="layer">{{ index + 1 }}</span>
          <div>
            <h3>{{ net.name }} <code>{{ net.command }}</code></h3>
            <p>{{ net.catches }}</p>
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.agents { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: clamp(32px, 6vw, 80px); align-items: center; }
.term pre { min-height: 470px; font-size: 12.5px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
.prompt { color: var(--l-orange); }
.cmd { color: var(--l-code-ink); }
.out { color: var(--l-code-dim); }
.ok { color: var(--l-green); font-weight: 600; }
.bad { display: inline-block; padding: 6px 10px; margin: 2px 0; border-radius: 0; color: var(--l-red); background: color-mix(in srgb, var(--l-red) 10%, transparent); border-left: 3px solid var(--l-red); }
.caret { display: inline-block; width: 8px; height: 15px; margin-left: 2px; vertical-align: -2px; background: var(--l-green); animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }

.nets { list-style: none; display: grid; gap: 0; margin-top: 32px; position: relative; }
.nets li { position: relative; display: flex; gap: 16px; padding: 16px 0; }
.nets li + li { border-top: 1px dashed var(--l-border-strong); }
.layer { flex: none; width: 30px; height: 30px; border-radius: 2px; display: grid; place-items: center; font-family: var(--vp-font-family-mono); font-weight: 600; font-size: 13px; color: var(--l-orange); border: 1px solid var(--l-border-strong); }
.nets h3 { font-size: 16px; font-weight: 650; color: var(--l-ink); }
.nets h3 code { margin-left: 6px; padding: 2px 7px; border-radius: 3px; font-size: 12px; font-weight: 600; color: var(--l-ink-2); background: var(--l-bg-2); border: 1px solid var(--l-border); }
.nets p { margin-top: 4px; font-size: 14.5px; line-height: 1.55; color: var(--l-ink-2); }

@media (max-width: 1000px) { .agents { grid-template-columns: minmax(0, 1fr); } .copy { order: -1; } .term pre { min-height: 0; } }
</style>
