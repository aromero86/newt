// bun run cooper: cooper in development, and stops it all together. One process, the
// backend: every context on its port, each serving its API and its frontend from its
// sources, which Bun builds as it serves them and reloads as they change. With --watch
// the backend restarts on every change of its own. It runs in its own process group, so
// stopping it also stops what it spawns. The ports are fixed (it fails instead of moving
// to another one), so the links below always hold.
import { config } from '../backend/config'

const watch = Bun.argv.includes('--watch')

const SERVICES = [
  {
    name: 'backend',
    url: `http://localhost:${config.auth.port}/api/health`,
    cmd: ['bun', ...(watch ? ['--watch'] : []), 'cooper/backend/index.ts'],
    env: { ...process.env, COOPER_FRONTEND_SOURCES: '1' },
  },
]

// The backend serves every context, each one on its own port: they must all be free.
const PORTS = (['auth', 'boards', 'backoffice'] as const).map(name => ({ name, port: config[name].port }))

// Nothing starts unless every port is free: `bun --watch`, for one, stays alive after
// failing to listen, so a taken port would go unnoticed otherwise.
async function isTaken(port: number) {
  for (const hostname of ['127.0.0.1', '::1']) {
    try {
      const socket = await Bun.connect({ hostname, port, socket: { data() {} } })
      socket.end()
      return true
    } catch {
      // Nothing listening on this address.
    }
  }
  return false
}

const taken = (await Promise.all(PORTS.map(async each => ((await isTaken(each.port)) ? each : null)))).filter(each => each !== null)
if (taken.length > 0) {
  for (const { name, port } of taken) console.error(`${name}: port ${port} is already in use`)
  console.error('Nothing was started.')
  process.exit(1)
}

const children = SERVICES.map(({ cmd, env }) => Bun.spawn(cmd, { detached: true, env, stdio: ['inherit', 'inherit', 'inherit'] }))

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

async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  signalGroups('SIGINT')
  // Whatever ignores SIGINT gets SIGTERM after a grace period.
  const timeout = setTimeout(() => signalGroups('SIGTERM'), 3000)
  await Promise.all(children.map(child => child.exited))
  clearTimeout(timeout)
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown())

// If any service dies on its own, everything stops with it.
children.forEach((child, index) => {
  void child.exited.then(code => {
    if (stopping) return
    console.error(`${SERVICES[index]!.name} exited (code ${code}): stopping everything.`)
    void shutdown(1)
  })
})

async function waitUntilUp(url: string) {
  while (!stopping) {
    try {
      await fetch(url)
      return
    } catch {
      await Bun.sleep(200)
    }
  }
}

// Once it answers, print where each context lives.
void Promise.all(SERVICES.map(({ url }) => waitUntilUp(url))).then(() => {
  if (stopping) return
  const names = ['auth', 'boards', 'backoffice'] as const
  const width = Math.max(...names.map(name => name.length))
  console.log(['', ...names.map(name => `  ${name.padEnd(width)}  ${config[name].publicUrl}`), ''].join('\n'))
})

await Promise.all(children.map(child => child.exited))
