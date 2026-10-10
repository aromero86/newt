// Starts every project in development mode and stops them all together.
// Each service runs in its own process group, so stopping it also stops the
// processes it spawns (astro dev, for one, runs its server in a child process).
// The ports are fixed (each service fails instead of moving to another one), so
// the links below always hold.
const SERVICES = [
  // --ignore-lock keeps astro in the foreground: when it detects an AI agent it
  // otherwise moves the dev server to the background and returns.
  { name: 'landing', url: 'http://localhost:4321', cmd: ['bun', 'x', 'astro', 'dev', '--ignore-lock'], cwd: 'src/landing' },
  { name: 'frontend', url: 'http://localhost:5173', cmd: ['bun', 'x', 'vite', 'src/frontend'] },
  { name: 'api', url: `http://localhost:${process.env.API_PORT ?? 3000}`, cmd: ['bun', '--watch', 'src/backend/index.ts'] },
]

// Nothing starts unless every port is free: `bun --watch`, for one, stays alive
// after failing to listen, so a taken port would go unnoticed otherwise.
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

const taken = (await Promise.all(SERVICES.map(async service => ((await isTaken(Number(new URL(service.url).port))) ? service : null)))).filter(
  service => service !== null,
)
if (taken.length > 0) {
  for (const { name, url } of taken) console.error(`${name}: ${url} is already in use`)
  console.error('Nothing was started.')
  process.exit(1)
}

const children = SERVICES.map(({ cmd, cwd }) => Bun.spawn(cmd, { cwd, detached: true, stdio: ['inherit', 'inherit', 'inherit'] }))

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

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => shutdown())

// If any service dies on its own, everything stops with it.
children.forEach((child, index) => {
  child.exited.then(code => {
    if (stopping) return
    console.error(`${SERVICES[index].name} exited (code ${code}): stopping everything.`)
    shutdown(1)
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

// Once everything answers, print where each service lives.
Promise.all(SERVICES.map(({ url }) => waitUntilUp(url))).then(() => {
  if (stopping) return
  const width = Math.max(...SERVICES.map(({ name }) => name.length))
  console.log(['', ...SERVICES.map(({ name, url }) => `  ${name.padEnd(width)}  ${url}`), ''].join('\n'))
})

await Promise.all(children.map(child => child.exited))
