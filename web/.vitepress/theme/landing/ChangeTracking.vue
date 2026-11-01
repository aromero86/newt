<script setup lang="ts">
import { computed, ref } from 'vue'
import { highlight } from './highlight'
import { onInView, reducedMotion, useTimers } from './motion'

/** What you write, a card that edits itself, and what newt does with it, one step at a time. */
const code = [
  `// card.module.ts: the use case`,
  `const card = await this.repo.get(input.id)`,
  `card.edit({ title: input.title }, author)`,
  `await this.repo.persist(card)`,
  ``,
  `// card.ts: the entity`,
  `edit(changes: CardChanges, author: Author) {`,
  `  this.change(changes)`,
  `  const diff = this.getChanges()`,
  `  if (diff) this.trackEvent(new Card_Edited({`,
  `    dto: this.toDTO(), changes: diff,`,
  `    previous: this.getPrevious()!, ...author,`,
  `  }))`,
  `}`,
].map(highlight)

const steps = [
  { lines: [1], title: 'Loaded', text: 'The repository hands back the card, and newt keeps a snapshot of it as it came: version 3.' },
  { lines: [2, 7], title: 'Changed', text: 'change() parses the fields with the schema and sets only those that really differ. newt stamps updatedAt.' },
  { lines: [8, 9, 10, 11, 12], title: 'Told', text: 'getChanges() is what differs from the snapshot; getPrevious(), what was there. The entity tracks one card.edited with both.' },
  { lines: [3], title: 'Saved', text: 'One transaction: an UPDATE with only what changed, guarded by the version, and the event\'s jobs in the outbox.' },
  { lines: [3], title: 'Heard', text: 'After the commit, every worker that hears card.edited takes its job, in a transaction of its own.' },
]
const DWELL = 3200

const step = ref(-1)
const timers = useTimers()
const shown = computed(() => Math.max(0, step.value))
function play(from = 0) {
  timers.clear()
  if (reducedMotion()) { step.value = steps.length - 1; return }
  step.value = from
  const tick = () => timers.after(step.value === steps.length - 1 ? DWELL * 1.8 : DWELL, () => { step.value = (step.value + 1) % steps.length; tick() })
  tick()
}
function pick(index: number) { play(index) }
const root = ref<HTMLElement>()
onInView(root, () => play(step.value < 0 ? 0 : step.value), { threshold: 0.3, leave: () => timers.clear() })

const fields = [
  { name: 'title', before: '"Plan sprint"', after: '"Plan the sprint"', changes: true },
  { name: 'columnId', before: 'col_7', after: 'col_7' },
  { name: 'position', before: '2', after: '2' },
  { name: 'updatedAt', before: '09:12:04', after: '10:41:37', stamped: true },
  { name: 'version', before: '3', after: '3' },
]
const workers = ['activity.recordEdited', 'card.indexCard']
</script>

<template>
  <div ref="root" class="tracking" :style="{ '--dwell': `${DWELL}ms` }">
    <div class="code l-window">
      <div class="l-window-bar"><i /><i /><i /><em>what you write</em></div>
      <pre><code><span v-for="(line, index) in code" :key="index" class="line" :class="{ lit: steps[shown].lines.includes(index) }" v-html="line || ' '" /></code></pre>
    </div>

    <div class="engine">
      <ol class="dots" role="tablist" aria-label="What newt does">
        <li v-for="(each, index) in steps" :key="each.title" role="tab" tabindex="0" :aria-selected="index === shown" :class="{ on: index === shown, done: index < shown }"
            @click="pick(index)" @keydown.enter="pick(index)">
          <span>{{ index + 1 }}</span>{{ each.title }}
        </li>
      </ol>
      <Transition name="say" mode="out-in"><p :key="shown" class="say">{{ steps[shown].text }}</p></Transition>

      <div class="card-state" :class="`s${shown}`">
        <p class="head"><b>card_9f2</b> as newt sees it <em v-if="shown >= 3">saved · version 4</em></p>
        <div v-for="field in fields" :key="field.name" class="field" :class="{ changes: field.changes && shown >= 1, stamped: field.stamped && shown >= 1, version: field.name === 'version' && shown >= 3 }">
          <code class="name">{{ field.name }}</code>
          <code class="value">
            <s v-if="(field.changes || field.stamped) && shown >= 1">{{ field.before }}</s>
            {{ field.name === 'version' ? (shown >= 3 ? '4' : '3') : shown >= 1 ? field.after : field.before }}
          </code>
        </div>
      </div>

      <div class="below">
        <div v-if="shown === 2" key="told" class="box event">
          <p class="tag">◇ card.edited</p>
          <code>changes: { title: "Plan the sprint" }</code>
          <code>previous: { title: "Plan sprint" }</code>
        </div>
        <div v-else-if="shown === 3" key="saved" class="box sql">
          <code><b>BEGIN</b></code>
          <code><b>UPDATE</b> card <b>SET</b> title = ?, updated_at = ?, version = 4 <b>WHERE</b> id = ? <b>AND</b> version = 3</code>
          <code><b>INSERT</b> jobs: activity.recordEdited.on.card.edited, card.indexCard.on.card.edited</code>
          <code><b class="ok">COMMIT ✓</b></code>
          <p class="note">No row with version 3? Someone saved first: ConcurrencyConflict, and the use case runs again on the new card.</p>
        </div>
        <div v-else-if="shown === 4" key="heard" class="box heard">
          <p class="tag">◇ card.edited, after the commit</p>
          <div class="workers"><span v-for="(worker, index) in workers" :key="worker" :style="{ '--i': index }">⚙ {{ worker }} <b>✓</b></span></div>
        </div>
        <div v-else key="idle" class="box idle">
          <code>initial = {{ '{' }} title: "Plan sprint", columnId: col_7, position: 2, … {{ '}' }}</code>
        </div>
      </div>
      <span class="bar"><i :key="shown" /></span>
    </div>
  </div>
</template>

<style scoped>
.tracking { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; align-items: stretch; }

.code pre { margin: 0; padding: 16px 0; overflow-x: auto; font-size: 13px; line-height: 1.75; }
.code code { display: grid; font-family: var(--vp-font-family-mono); color: var(--l-code-ink); }
.line { padding: 0 18px; border-left: 3px solid transparent; transition: background .3s ease, border-color .3s ease, opacity .3s ease; white-space: pre; }
.line.lit { background: color-mix(in srgb, var(--l-orange) 12%, transparent); border-left-color: var(--l-orange); }

.engine { position: relative; display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: 6px; background: var(--l-panel); border: 1px solid var(--l-border); box-shadow: var(--l-shadow); overflow: hidden; }
.dots { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
.dots li { display: inline-flex; align-items: center; gap: 7px; padding: 5px 10px 5px 5px; border-radius: 4px; font-size: 13px; font-weight: 650; color: var(--l-ink-3); border: 1px solid var(--l-border); cursor: pointer; transition: all .25s ease; }
.dots li span { width: 20px; height: 20px; display: grid; place-items: center; border-radius: 3px; font-family: var(--vp-font-family-mono); font-size: 11px; background: var(--l-bg-2); }
.dots li.on { color: var(--l-ink); border-color: var(--l-orange); }
.dots li.on span { background: var(--l-orange); color: var(--l-on-accent); }
.dots li.done span { background: var(--l-green); color: var(--l-on-accent); }
.say { min-height: 3.2em; font-size: 15px; line-height: 1.6; color: var(--l-ink-2); }
.say-enter-active, .say-leave-active { transition: opacity .25s ease, transform .25s ease; }
.say-enter-from { opacity: 0; transform: translateY(6px); }
.say-leave-to { opacity: 0; transform: translateY(-6px); }

.card-state { border-radius: 4px; border: 1px solid var(--l-border); background: var(--l-panel-solid); overflow: hidden; }
.card-state .head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12.5px; color: var(--l-ink-3); border-bottom: 1px solid var(--l-border); background: var(--l-bg-2); }
.card-state .head b { font-family: var(--vp-font-family-mono); color: var(--l-ink); }
.card-state .head em { margin-left: auto; font-style: normal; font-family: var(--vp-font-family-mono); font-weight: 700; color: var(--l-green-ink); }
.field { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; padding: 6px 12px; font-size: 12.5px; border-left: 3px solid transparent; transition: background .35s ease, border-color .35s ease; }
.field + .field { border-top: 1px solid var(--l-code-line); }
.field .name { color: var(--l-ink-3); }
.field .value { color: var(--l-ink); overflow-wrap: anywhere; }
.field s { margin-right: 6px; color: var(--l-red); opacity: .75; }
.field.changes { background: color-mix(in srgb, var(--l-orange) 10%, transparent); border-left-color: var(--l-orange); }
.field.stamped { background: color-mix(in srgb, var(--l-yellow) 10%, transparent); border-left-color: var(--l-yellow); }
.field.version { background: color-mix(in srgb, var(--l-green) 12%, transparent); border-left-color: var(--l-green); }
.s2 .field.changes { animation: blink .9s ease 2; }
@keyframes blink { 50% { background: color-mix(in srgb, var(--l-orange) 26%, transparent); } }

.below { min-height: 150px; }
.box { display: grid; gap: 6px; padding: 12px 14px; border-radius: 4px; font-size: 12.5px; animation: rise .4s ease both; }
.box code { font-family: var(--vp-font-family-mono); line-height: 1.55; color: var(--l-ink-2); overflow-wrap: anywhere; }
.box b { color: var(--l-blue); }
.box b.ok { color: var(--l-green-ink); }
.box .tag { font-family: var(--vp-font-family-mono); font-weight: 800; color: var(--l-orange); }
.box .note { margin-top: 4px; font-size: 12.5px; color: var(--l-ink-3); }
.idle { border: 1px dashed var(--l-border-strong); }
.event { border: 1px solid var(--l-orange); background: color-mix(in srgb, var(--l-orange) 6%, transparent); }
.sql { border: 1px solid var(--l-blue); background: color-mix(in srgb, var(--l-blue) 6%, transparent); }
.sql code { animation: rise .35s ease both; }
.sql code:nth-child(2) { animation-delay: .3s; }
.sql code:nth-child(3) { animation-delay: .6s; }
.sql code:nth-child(4) { animation-delay: .9s; }
.heard { border: 1px solid var(--l-green); background: color-mix(in srgb, var(--l-green) 6%, transparent); }
.workers { display: flex; flex-wrap: wrap; gap: 8px; }
.workers span { padding: 6px 10px; border-radius: 3px; font-family: var(--vp-font-family-mono); font-weight: 650; color: var(--l-ink); background: var(--l-panel-solid); border: 1px solid var(--l-border); animation: rise .4s ease both; animation-delay: calc(.3s + var(--i) * 250ms); }
.workers b { color: var(--l-green-ink); }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }

.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--l-border); }
.bar i { display: block; height: 100%; transform-origin: 0 50%; background: var(--l-orange); animation: fill var(--dwell) linear forwards; }
@keyframes fill { from { transform: scaleX(0); } }

@media (max-width: 1000px) { .tracking { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 640px) { .field { grid-template-columns: 86px minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .bar { display: none; } }
</style>
