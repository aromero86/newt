// Starts every project in development mode and stops them all together.
// Each service runs in its own process group, so stopping it also stops the
// processes it spawns (astro dev, for one, runs its server in a child process).
const SERVICES = [
  { cmd: ['bun', '--watch', 'src/backend/index.ts'] },
  { cmd: ['bun', 'x', 'vite', 'src/frontend'] },
  // --ignore-lock keeps astro in the foreground: when it detects an AI agent it
  // otherwise moves the dev server to the background and returns.
  { cmd: ['bun', 'x', 'astro', 'dev', '--ignore-lock'], cwd: 'src/landing' },
]

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

async function shutdown() {
  if (stopping) return
  stopping = true
  signalGroups('SIGINT')
  // Whatever ignores SIGINT gets SIGTERM after a grace period.
  const timeout = setTimeout(() => signalGroups('SIGTERM'), 3000)
  await Promise.all(children.map(child => child.exited))
  clearTimeout(timeout)
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown)

await Promise.all(children.map(child => child.exited))
