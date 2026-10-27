# A monitor built with newt

The monitor is a package of the repository, beside newt-graph and newt-eslint, and an
application built with newt, as cooper is. This chapter makes the package, its one
context, `monitor`, with its own SQLite database, its settings read from the
environment, and the command that starts it. It has no module yet: it answers one
question, whether it is up.

At the end you will have these files:

```
package.json                     changed: `bun run monitor`
tsconfig.json                    changed: it references the monitor's project
tsconfig.newt-monitor.json       the monitor's TypeScript project
eslint.config.js                 changed: newt's lint on the monitor
packages/newt-monitor/
  package.json                   the package, and its command
  bin/newt-monitor.ts            the command: `bunx newt-monitor`
  src/
    config.ts                    its settings, from the environment
    main.ts                      opens its context and serves it
    monitor-base.ts              what every module of it receives
    monitor.test.ts              its first tests
    contexts/monitor/
      monitor.context.ts         the context: its store, its modules, its server
      initialize-modules.ts      its modules: none yet
    testing/
      open-test-monitor.ts       the monitor, for a test
```

## The package

A package of its own, with a command. It depends on newt as any application does, by
its name, through the package's `exports`:

```json
// packages/newt-monitor/package.json
{
  "name": "newt-monitor",
  "version": "0.0.0",
  "description": "Watches newt applications: what each one is made of, read from it as it runs, never from its data. A newt application itself.",
  "type": "module",
  "bin": {
    "newt-monitor": "./bin/newt-monitor.ts"
  },
  "engines": {
    "bun": ">=1.4.0"
  },
  "dependencies": {
    "newt": "workspace:*",
    "zod": "4.3.6"
  }
}
```

The repository's `package.json` takes every folder of `packages/` as a workspace, so
`bun install` links it. The command runs `main`, and turns what stops it into a line
and an exit code:

```ts
// packages/newt-monitor/bin/newt-monitor.ts
#!/usr/bin/env bun
import { main } from '../src/main'

try {
  await main(process.env)
} catch (error) {
  console.error(`newt-monitor: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

Its TypeScript project is a backend's, as cooper's is ([chapter 1 of the
guide](../guide/01-project-and-context)): `tsconfig.newt-monitor.json`, with `lib:
["ES2023"]`, `types: ["bun"]` and `strict`, included by the root `tsconfig.json` among
its `references`.

## newt's lint

The monitor is an application, so newt's lint keeps it, with one context that uses
none:

```js
// newt-monitor is an application built with newt too, so it keeps the same lint.
const MONITOR = newt({
  files: ['packages/newt-monitor/**/*.ts'],
  contexts: { folder: 'packages/newt-monitor/src/contexts', uses: { monitor: [] } },
})
```

The framework's own packages stay out of it (`ignores`); this one is in.

## Its settings

The monitor reads its environment once, at the start, and nothing else does: the
context receives its config. Each variable has a schema; any one that is wrong stops it
before it opens anything, every one of them named:

```ts
// packages/newt-monitor/src/config.ts
import { z } from 'zod'

/** What the monitor is told by its environment, each variable with what it is for. */
const EnvSchema = z.object({
  /** Where it listens. */
  NEWT_MONITOR_PORT: z.coerce.number().int().min(0).max(65_535).default(4800),
  /** Its SQLite database: a file, made with its folder if missing, or `:memory:`. */
  NEWT_MONITOR_DATA: z.string().trim().min(1).default('data/newt-monitor.db'),
})
```

```ts
// packages/newt-monitor/src/config.ts
export function readConfig(env: Record<string, string | undefined>): MonitorConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`it cannot start:\n  ${problems.join('\n  ')}`)
  }
  return { port: parsed.data.NEWT_MONITOR_PORT, database: parsed.data.NEWT_MONITOR_DATA }
}
```

The next chapters add the user, the password and the secret: three variables with no
default, so a monitor nobody configured does not start.

## The base and the context

Every module receives the base. The monitor's runs on SQLite, and carries the router
its modules register their routes on:

```ts
// packages/newt-monitor/src/monitor-base.ts
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'
import { Base } from 'newt/runtime'

/**
 * What every module of the monitor receives: newt's base, on SQLite, with the router
 * its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class MonitorBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
```

The context opens its store (making the database's folder the first time), creates
its base and initializes its modules. It says how it is served: its modules' API under
`/api`, and `GET /api/health` without a session.

```ts
// packages/newt-monitor/src/contexts/monitor/monitor.context.ts
export class Monitor_Context extends BoundedContext<MonitorBase> {

  private constructor(base: MonitorBase, readonly modules: Monitor_Modules, private readonly config: MonitorConfig) {
    super('monitor', base)
  }

  static async open(config: MonitorConfig, clock?: Clock): Promise<Monitor_Context> {
    if (config.database !== ':memory:') await mkdir(dirname(config.database), { recursive: true })
    const store = await SqliteStore.open({ path: config.database })
    const base = new MonitorBase({ name: 'monitor', store, clock })
    return new Monitor_Context(base, initializeModules(base), config)
  }

  /** How it is served (`runContexts`): its modules' API under `/api`, and `GET /api/health` for whoever watches it is up. */
  serving(): ServeOptions {
    return { port: this.config.port, router: this.base.http, health: true }
  }
}
```

`initializeModules` has nothing to initialize yet: it returns `{}`.

## Starting it

`main` puts it together: the settings, the context, and `runContexts`, which serves it,
starts its worker, and stops both on SIGINT or SIGTERM:

```ts
// packages/newt-monitor/src/main.ts
export async function main(env: Record<string, string | undefined>): Promise<RunningContexts> {
  const config = readConfig(env)
  const monitor = await Monitor_Context.open(config)
  const app = runContexts([{ context: monitor, serve: monitor.serving() }])
  console.log(`newt-monitor listening on ${app.servers.monitor!.url}`)
  return app
}
```

## Tests

Every test opens the monitor the same way: its database in memory, on a free port.
`openTestMonitor` does it once for all of them, and grows with the chapters:

```ts
// packages/newt-monitor/src/testing/open-test-monitor.ts
export async function openTestMonitor(options: TestMonitorOptions = {}) {
  const monitor = await Monitor_Context.open({ port: 0, database: ':memory:', ...options })
  const app = runContexts([{ context: monitor, serve: monitor.serving() }], { signals: false })
```

```ts
// packages/newt-monitor/src/monitor.test.ts
describe('its settings', () => {
  test('have what development needs by default', () => {
    expect(readConfig({})).toEqual({ port: 4800, database: 'data/newt-monitor.db' })
  })

  test('stop it before it starts, naming every variable that is wrong', () => {
    expect(() => readConfig({ NEWT_MONITOR_PORT: 'eighty', NEWT_MONITOR_DATA: ' ' })).toThrow(/NEWT_MONITOR_PORT[\s\S]*NEWT_MONITOR_DATA/)
  })
})
```

## Check it

```sh
bun check
bun test packages/newt-monitor
bun run lint
bun run monitor
```

```
newt-monitor listening on http://localhost:4800/
```

```sh
curl -s localhost:4800/api/health
```

```json
{"status":"ok"}
```

## What to remember

- The monitor is an application built with newt: a package of its own, its TypeScript
  project, newt's lint, one context.
- The environment is read once, by `readConfig`; a variable that is wrong stops it, all
  of them named. The context receives its config.
- The context opens its store, its base and its modules, and says how it is served.

Next: signing in.
