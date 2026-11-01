<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import { highlight } from './highlight'
import { reducedMotion, useTimers } from './motion'

/** How a backend rots as it grows, and what newt does about each: the code before, and with newt. */
const chapters = [
  {
    pain: 'The logic leaks into the routes',
    story: 'A handler validates, writes two tables and sends an email. Six months later, nobody dares to touch it.',
    answer: 'A route does not think',
    how: 'It reads the request, calls one use case, answers. The use case validates, asks who may, lets the entity change itself and saves once. The email leaves from a worker.',
    link: '/book/06-use-cases',
    before: {
      file: 'routes/cards.ts',
      code: `app.post('/cards', async (req, res) => {
  const card = req.body as Card
  if (!card.title) return res.status(400).end()
  await db.query('INSERT INTO card …', [card])
  await db.query('UPDATE board SET cards = cards + 1')
  await mailer.send(card.assignee, 'New card')
  res.json(card)
})`,
      verdict: 'Validation, SQL, a mail and the answer, tangled in one handler.',
    },
    after: {
      file: 'cooper/…/card/card.routes.ts',
      code: `workspace.post('/boards/:boardId/cards', async request =>
  Response.json(
    await cards.create(request.params.boardId, await request.json()),
    { status: 201 },
  ),
  { idempotency: {
    table: base.store.table<KeptAnswer>('idempotency_key'),
  } })`,
      verdict: 'Reads, calls one use case, answers. Sent twice, done once.',
    },
  },
  {
    pain: 'Events get lost',
    story: 'The row is saved, the process restarts, the event is never published. The invoice is never sent, and nothing tells you.',
    answer: 'Events are born in the entity',
    how: 'The entity tracks what happened. The event is written in the same transaction as the change, and a worker runs every reaction until it succeeds.',
    link: '/book/09-events',
    before: {
      file: 'services/cards.ts',
      code: `await db.insert('card', card)
// the process restarts right here
await queue.publish('card.created', card)
// nobody hears of this card. Ever.`,
      verdict: 'Two writes to two systems: one of them will fail alone.',
    },
    after: {
      file: 'cooper/…/card/card.ts',
      code: `static create(input: CardOpening, author: CardAuthor): Card {
  const card = new Card(input, true)
  card.author = author
  card.trackEvent(new Card_Created({ ...card.toDTO(), ...author }))
  return card
}
// card.module.ts: the card and its event, one transaction
await this.repo.persistNew(card)`,
      verdict: 'Saved with the change, told once it commits, never lost.',
    },
  },
  {
    pain: 'Two people, one record',
    story: 'Ana moves a card while Bob renames it. One of the changes silently disappears.',
    answer: 'Versions, and a second run',
    how: 'Every row has a version. A save that read an old one throws, and the use case runs again on fresh data: on SQLite, Postgres and MySQL alike.',
    link: '/book/20-concurrency',
    before: {
      file: 'two tabs, one second apart',
      code: `-- Ana, 10:02:01
UPDATE card SET column_id = 'done' WHERE id = 42
-- Bob, 10:02:01, from what he read a second ago
UPDATE card SET title = 'Ship it', column_id = 'todo'
 WHERE id = 42
-- Ana's move is gone`,
      verdict: 'Last write wins, and nobody is told.',
    },
    after: {
      file: 'cooper/…/card/card.module.ts',
      code: `@UseCase()
async edit(id: string, input: unknown): Promise<CardDTO> {
  const changes = CardEditSchema.parse(input)
  const card = await this.load(id)
  card.edit(changes, actingAuthor())
  await this.repo.persist(card)   // an old version: run again
  return card.toDTO()
}`,
      verdict: 'A ConcurrencyConflict runs the use case again, up to 3 more times.',
    },
  },
  {
    pain: 'A tenant sees another\'s data',
    story: 'One forgotten where clause, and Acme reads Globex\'s boards.',
    answer: 'Scopes the repository keeps',
    how: 'A repository of tenant rows says its scope, and sees only the current one. Saving a row of another scope throws. A stranger gets a 404.',
    link: '/book/22-tenants',
    before: {
      file: 'routes/boards.ts',
      code: `const board = await db.query(
  'SELECT * FROM board WHERE id = $1',
  [req.params.id],
)
// whose board? Acme's, Globex's, anyone's.`,
      verdict: 'Every query must remember the tenant. One will not.',
    },
    after: {
      file: 'cooper/…/card/card.repository.ts',
      code: `class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {
  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card'), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }
}
// find, page, count: only the current workspace's rows`,
      verdict: 'Said once, kept on every read and every save.',
    },
  },
  {
    pain: 'Nobody knows what calls what',
    story: 'Which module listens to card.created? What breaks if I change this payload? The answer lives in someone\'s head.',
    answer: 'The structure, declared and drawn',
    how: 'Every module declares what it uses. The lint keeps the boundaries, and the application describes itself to newt-monitor, which draws it.',
    link: '/book/42-structure',
    before: {
      file: 'terminal',
      code: `$ grep -rn "card.created" src/
src/jobs/index.ts:12      emitter.on('card.created', …)
src/legacy/stats.ts:88    emitter.on('card.created', …)
src/billing/hooks.ts:301  // TODO: still used?`,
      verdict: 'Strings, a grep, and hope.',
    },
    after: {
      file: 'cooper/…/card/card.deps.ts',
      code: `export interface Card_Deps {
  board: Board_Module
  column: Column_Module
  member: Member_Module
  /** another context, by its module: never its tables */
  auth: { access: Access_Module }
}`,
      verdict: 'Typed, checked by the lint, drawn by the monitor.',
    },
  },
  {
    pain: 'AI writes code with no rails',
    story: 'Your coding agent is fast. It is also happy to write another module\'s rows from a request and call out mid-transaction.',
    answer: 'Rules a machine checks',
    how: 'An AGENTS.md versioned with the package, a lint that knows newt\'s anatomy, and runtime rules whose errors say what to do instead.',
    link: '/book/33-agents',
    before: {
      file: 'label.module.ts, at 2 a.m.',
      code: `@UseCase()
async attach(cardId: string, input: unknown) {
  const { labelId } = LabelAttachSchema.parse(input)
  // straight into another module, from a request
  await this.deps.card.edit(cardId, { labelIds: [labelId] })
}`,
      verdict: 'Compiles. Ships. Breaks the boundaries you drew.',
    },
    after: {
      file: 'bun test',
      code: `✕ [write rule] label.attach writes to boards.card outside a
  worker: write it from a worker reacting to an event, or list
  it in its writesTo`,
      verdict: 'Refused the first time it runs, with what to do instead.',
    },
  },
]

const active = ref(0)
const showing = ref<'before' | 'after'>('before')
const chapter = computed(() => chapters[active.value]!)
const code = computed(() => highlight(chapter.value[showing.value].code))
const timers = useTimers()

watch(active, () => {
  timers.clear()
  if (reducedMotion()) { showing.value = 'after'; return }
  showing.value = 'before'
  timers.after(1700, () => { showing.value = 'after' })
}, { immediate: true })

const items = ref<HTMLElement[]>([])
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) active.value = items.value.indexOf(entry.target as HTMLElement)
    }
  }, { rootMargin: '-45% 0px -45% 0px' })
  items.value.forEach(item => observer!.observe(item))
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="story">
    <ol class="chapters">
      <li v-for="(item, index) in chapters" :key="item.pain" ref="items" :class="{ on: index === active }">
        <span class="index">{{ String(index + 1).padStart(2, '0') }}</span>
        <p class="pain">{{ item.pain }}</p>
        <p class="tale">{{ item.story }}</p>
        <div class="answer">
          <span class="tick">✓</span>
          <div>
            <h3>{{ item.answer }}</h3>
            <p>{{ item.how }}</p>
            <a :href="withBase(item.link)">How it works →</a>
          </div>
        </div>
        <div class="inline l-window" aria-hidden="true">
          <div class="l-window-bar"><i /><i /><i /><em>{{ item.after.file }}</em></div>
          <pre><code v-html="highlight(item.after.code)" /></pre>
        </div>
      </li>
    </ol>

    <div class="sticky">
      <div class="panel">
        <div class="switch" role="tablist" aria-label="The code, before and with newt">
          <span class="thumb" :class="showing" />
          <button role="tab" :aria-selected="showing === 'before'" :class="{ on: showing === 'before' }" @click="timers.clear(); showing = 'before'">Without newt</button>
          <button role="tab" :aria-selected="showing === 'after'" :class="{ on: showing === 'after' }" @click="timers.clear(); showing = 'after'">With newt</button>
        </div>
        <div class="l-window code" :class="showing">
          <div class="l-window-bar"><i /><i /><i /><em>{{ chapter[showing].file }}</em></div>
          <Transition name="swap" mode="out-in">
            <pre :key="active + showing"><code v-html="code" /></pre>
          </Transition>
          <div class="scan" aria-hidden="true" />
        </div>
        <Transition name="swap" mode="out-in">
          <p :key="active + showing" class="verdict" :class="showing">
            <span>{{ showing === 'before' ? '✕' : '✓' }}</span>{{ chapter[showing].verdict }}
          </p>
        </Transition>
        <div class="dots" aria-hidden="true">
          <i v-for="(item, index) in chapters" :key="item.pain" :class="{ on: index === active }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.story { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: clamp(32px, 6vw, 88px); }
.chapters { list-style: none; }
.chapters li { min-height: 76vh; display: flex; flex-direction: column; justify-content: center; padding: 40px 0; opacity: .28; transition: opacity .6s ease, transform .6s ease; transform: translateX(-8px); }
.chapters li.on { opacity: 1; transform: none; }
.chapters li:first-child { min-height: 60vh; }
.index { font-family: var(--vp-font-family-mono); font-size: 13px; font-weight: 700; color: var(--l-red); letter-spacing: .08em; }
.pain { margin-top: 10px; font-size: clamp(28px, 3.4vw, 40px); line-height: 1.08; letter-spacing: -0.03em; font-weight: 800; color: var(--l-ink); }
.tale { margin-top: 14px; font-size: 17px; line-height: 1.6; color: var(--l-ink-2); }
.answer { display: flex; gap: 14px; margin-top: 28px; padding: 20px 22px; border-radius: 16px; background: color-mix(in srgb, var(--l-green) 9%, transparent); border: 1px solid color-mix(in srgb, var(--l-green) 30%, transparent); }
.tick { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: #fff; background: var(--l-green); box-shadow: 0 0 0 5px color-mix(in srgb, var(--l-green) 18%, transparent); }
.answer h3 { font-size: 18px; font-weight: 750; color: var(--l-green-ink); }
.answer p { margin-top: 6px; font-size: 15px; line-height: 1.6; color: var(--l-ink-2); }
.answer a { display: inline-block; margin-top: 10px; font-size: 14px; font-weight: 650; color: var(--l-green-ink); }
.inline { display: none; margin-top: 20px; }

.sticky { position: relative; }
.panel { position: sticky; top: calc(var(--vp-nav-height, 64px) + 12vh); }
.switch { position: relative; display: inline-grid; grid-template-columns: 1fr 1fr; padding: 4px; margin-bottom: 18px; border-radius: 999px; background: var(--l-panel); border: 1px solid var(--l-border); }
.switch button { position: relative; z-index: 1; height: 36px; padding: 0 18px; border-radius: 999px; font-size: 13.5px; font-weight: 650; color: var(--l-ink-3); transition: color .3s ease; }
.switch button.on { color: #fff; }
.thumb { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc(50% - 4px); border-radius: 999px; background: var(--l-red); transition: transform .5s cubic-bezier(.6,.0,.2,1), background .5s ease; box-shadow: 0 6px 18px -6px var(--l-red); }
.thumb.after { transform: translateX(100%); background: var(--l-green); box-shadow: 0 6px 18px -6px var(--l-green); }

.code { min-height: 300px; transition: box-shadow .6s ease, border-color .6s ease; }
.code.before { border-color: color-mix(in srgb, var(--l-red) 45%, transparent); box-shadow: var(--l-shadow-big), 0 0 0 1px color-mix(in srgb, var(--l-red) 25%, transparent), 0 30px 80px -30px color-mix(in srgb, var(--l-red) 60%, transparent); }
.code.after { border-color: color-mix(in srgb, var(--l-green) 45%, transparent); box-shadow: var(--l-shadow-big), 0 0 0 1px color-mix(in srgb, var(--l-green) 25%, transparent), 0 30px 80px -30px color-mix(in srgb, var(--l-green) 70%, transparent); }
.code.before pre { filter: saturate(.6); }
.scan { position: absolute; left: 0; right: 0; top: 40px; height: 60px; background: linear-gradient(transparent, rgba(255, 93, 98, .12), transparent); animation: scan 2.4s linear infinite; pointer-events: none; }
.code.after .scan { background: linear-gradient(transparent, rgba(34, 197, 143, .12), transparent); }
@keyframes scan { from { transform: translateY(-60px); } to { transform: translateY(300px); } }

.verdict { display: flex; gap: 10px; align-items: baseline; margin-top: 18px; font-size: 15.5px; font-weight: 600; line-height: 1.5; }
.verdict span { font-weight: 800; }
.verdict.before { color: var(--l-red); }
.verdict.after { color: var(--l-green-ink); }
.dots { display: flex; gap: 8px; margin-top: 22px; }
.dots i { width: 22px; height: 4px; border-radius: 4px; background: var(--l-border-strong); transition: background .4s ease, width .4s ease; }
.dots i.on { width: 44px; background: linear-gradient(90deg, var(--l-green), var(--l-orange)); }

.swap-enter-active, .swap-leave-active { transition: opacity .28s ease, transform .28s ease, filter .28s ease; }
.swap-enter-from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
.swap-leave-to { opacity: 0; transform: translateY(-8px); filter: blur(4px); }

@media (max-width: 960px) {
  .story { grid-template-columns: minmax(0, 1fr); }
  .sticky { display: none; }
  .chapters li, .chapters li:first-child { min-height: 0; opacity: 1; transform: none; padding: 36px 0; border-top: 1px solid var(--l-border); }
  .inline { display: block; }
}
</style>
