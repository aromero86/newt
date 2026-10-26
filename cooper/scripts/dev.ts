// bun run cooper: cooper in development, and stops it all together. The backend (every
// context, each on its port) and the Vite server of each frontend, which sends the
// API's addresses on to its context. With --watch the backend restarts on every change.
// Each service runs in its own process group, so stopping it also stops what it spawns.
// The ports are fixed (each service fails instead of moving to another one), so the
// links below always hold.
import { config } from '../backend/config'

const watch = Bun.argv.includes('--watch')

/** A frontend's Vite server, on the port of its context's public URL. */
const frontend = (name: 'auth' | 'boards') => {
  const url = config[name].publicUrl
  return { name: `${name} UI`, url, cmd: ['bun', 'x', 'vite', `cooper/frontend/${name}`, '--port', new URL(url).port, '--strictPort'] }
}

const SERVICES = [
  frontend('auth'),
  frontend('boards'),
  { name: 'backend', url: `http://localhost:${config.auth.port}/api/health`, cmd: ['bun', ...(watch ? ['--watch'] : []), 'cooper/backend/index.ts'] },
]

// The backend serves every context, each one on its own port: they must all be free.
const PORTS = [
  ...SERVICES.filter(service => service.name !== 'backend').map(({ name, url }) => ({ name, port: Number(new URL(url).port) })),
  ...(['auth', 'boards'] as const).map(name => ({ name: `${name} API`, port: config[name].port })),
]

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

const children = SERVICES.map(({ cmd }) => Bun.spawn(cmd, { detached: true, stdio: ['inherit', 'inherit', 'inherit'] }))

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

// Once everything answers, print where each frontend lives.
void Promise.all(SERVICES.map(({ url }) => waitUntilUp(url))).then(() => {
  if (stopping) return
  const names = ['auth', 'boards'] as const
  const width = Math.max(...names.map(name => name.length))
  console.log(['', ...names.map(name => `  ${name.padEnd(width)}  ${config[name].publicUrl}  (API on port ${config[name].port})`), ''].join('\n'))
})

await Promise.all(children.map(child => child.exited))
