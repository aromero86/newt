// bun examples/despensa/main.ts: the shop on port 3000. STORE=sqlite keeps its data in
// SQLite (data/despensa.db); otherwise in files (data/despensa).
import { Shop_Context } from './shop.context'

const context = await Shop_Context.open({
  store: process.env.STORE === 'sqlite' ? { kind: 'sqlite', path: 'data/despensa.db' } : { kind: 'files', folder: 'data/despensa' },
  mailer: { send: async mail => console.log(`[mail] to ${mail.to}: ${mail.subject}`) },
})
const server = context.serve(Number(process.env.PORT ?? 3000))
context.start()
console.log(`despensa listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()
    await context.stop()
    process.exit(0)
  })
}
