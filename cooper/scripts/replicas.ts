// bun run cooper:replicas: two instances of cooper's backend side by side, as if behind a
// load balancer, for newt-monitor to show an application with more than one: they share
// the databases and one Redis, where they count their events, keep their traces and
// tell the monitor how each instance and its server is. Each one says it runs on a
// server of its own, `cooper-1` and `cooper-2`, though both run on this machine.
//
//   COOPER_REDIS_URL=redis://localhost:6379 COOPER_MONITOR_KEY=… bun run cooper:replicas
//
// The first listens where `bun run cooper` does, its monitor on 3010; the second 100
// ports up (3101 to 3103, its monitor on 3110). The monitor needs only one of them:
// either tells it all. Stopping it stops both; stopping one (`kill <pid>`) leaves the
// other running, for the monitor to see one go.
import { config } from '../backend/config'

if (!config.monitor.redisUrl || !config.monitor.key) {
  console.error('Two instances share one Redis and are monitored: COOPER_REDIS_URL and COOPER_MONITOR_KEY are needed.')
  process.exit(1)
}

/** How far up the second one's ports are. */
const SHIFT = 100

const REPLICAS = [0, SHIFT].map((shift, index) => ({
  name: `cooper-${index + 1}`,
  url: `http://localhost:${config.auth.port + shift}/api/health`,
  env: {
    ...process.env,
    COOPER_SERVER: process.env.COOPER_SERVER ?? `cooper-${index + 1}`,
    COOPER_AUTH_PORT: String(config.auth.port + shift),
    COOPER_BOARDS_PORT: String(config.boards.port + shift),
    COOPER_BACKOFFICE_PORT: String(config.backoffice.port + shift),
    COOPER_MONITOR_PORT: String(config.monitor.port + shift),
  },
}))

const children = REPLICAS.map(({ env }) => Bun.spawn(['bun', 'cooper/backend/index.ts'], { detached: true, env, stdio: ['inherit', 'inherit', 'inherit'] }))
for (const [index, child] of children.entries()) console.log(`${REPLICAS[index]!.name}: pid ${child.pid}`)

function signalGroups(signal: NodeJS.Signals) {
  for (const child of children) {
    try {
      process.kill(-child.pid, signal)
    } catch {
      // The group is already gone.
    }
  }
}

let stopping = false

async function shutdown() {
  if (stopping) return
  stopping = true
  signalGroups('SIGINT')
  // Whatever ignores SIGINT gets SIGTERM after a grace period.
  const timeout = setTimeout(() => signalGroups('SIGTERM'), 3000 + config.drainMs)
  await Promise.all(children.map(child => child.exited))
  clearTimeout(timeout)
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown())

// One that stops on its own leaves the other running: that is what the monitor is to see.
children.forEach((child, index) => {
  void child.exited.then(code => {
    if (!stopping) console.error(`${REPLICAS[index]!.name} exited (code ${code}); the other goes on.`)
  })
})

await Promise.all(children.map(child => child.exited))
