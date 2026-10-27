# Its pages

The monitor gets its pages: a React app, in the package, served by the monitor itself.
One process and one address, as [cooper's contexts](../guide/23-frontends) serve
theirs. This guide does not teach the app: it is made with `newt-react-ui` and
`newt-react`, whose `AGENTS.md` teach how. This chapter is how it is built and how the
monitor serves it.

At the end you will have these files:

```
package.json                          changed: `bun run monitor` serves the sources, `bun run monitor:build`
tsconfig.json                         changed: one project more
tsconfig.newt-monitor.json            changed: the frontend is not in it
tsconfig.newt-monitor-frontend.json   the frontend's project, for the browser
eslint.config.js                      changed: the frontend's lint
monitor.Dockerfile                    changed: it builds the frontend
packages/newt-monitor/
  package.json                        changed: what the frontend is built with
  frontend/                           the app: index.html, app.css, main.tsx, its pages
  scripts/build.ts                    the frontend, built
  scripts/dev.ts                      the monitor, its frontend from its sources
  src/config.ts                       changed: where the build is, or the sources
  src/main.ts                         changed: the sources, in development
  src/contexts/monitor/monitor.context.ts  changed: it serves the build
```

## Built: the monitor serves its folder

Two settings say where the frontend comes from:

```ts
// packages/newt-monitor/src/config.ts
  /** Its built frontend (`bun run monitor:build`). */
  NEWT_MONITOR_FRONTEND: z.string().trim().min(1).default(join(import.meta.dir, '../dist/frontend')),
  /** `1` (`bun run monitor` sets it): the frontend from its sources, which Bun builds as it serves them. */
  NEWT_MONITOR_FRONTEND_SOURCES: z.enum(['0', '1']).default('0'),
```

The folder is the package's own `dist/frontend` by default, wherever the monitor is
started from. The context hands it to `serve` as `frontend`:

```ts
// packages/newt-monitor/src/contexts/monitor/monitor.context.ts
  serving(): ServeOptions {
    return { port: this.config.port, router: this.base.http, health: true, frontend: this.config.frontend }
  }
```

Every address the API does not take gets a file of the folder, or its `index.html`, so
`/apps/…` opens the app and its router shows the page. Under `/api` it is never the
app: an address no route takes is a 404 the client can read. Until the folder has an
`index.html`, the pages answer a 503 that says it is not built, and the API works all
the same: that is why the tests need no build.

```ts
// packages/newt-monitor/src/monitor.test.ts
  test('hands its frontend every other address, and says so while it is not built', async () => {
    monitor = await openTestMonitor()

    const page = await monitor.fetch('/apps/cooper')
    expect(page.status).toBe(503)
    expect(await page.text()).toContain('not built')
  })
```

## Building it

`bun run monitor:build` builds the app with `Bun.build`, from its `index.html`, with
Tailwind:

```ts
// packages/newt-monitor/scripts/build.ts
const built = await Bun.build({
  entrypoints: [join(PACKAGE, 'frontend/index.html')],
  outdir: out,
  plugins: [tailwind],
  minify: true,
  // From the root: the app's router serves index.html at every address, however deep.
  publicPath: '/',
  sourcemap: 'linked',
  target: 'browser',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
```

What it is built with is the package's `devDependencies`: React, React Router,
`newt-react`, `newt-react-ui`, `bun-plugin-tailwind`. The image installs them, builds,
and runs:

```
# monitor.Dockerfile
RUN bun install --frozen-lockfile

COPY bunfig.toml ./
COPY packages/newt packages/newt
COPY packages/newt-react packages/newt-react
COPY packages/newt-react-ui packages/newt-react-ui
COPY packages/newt-monitor packages/newt-monitor
RUN bun run monitor:build
```

## In development: from its sources

`bun run monitor` starts the monitor with `NEWT_MONITOR_FRONTEND_SOURCES=1`, and
`--watch`. Then `main` hands `serve` the app's `index.html` imported instead of the
folder: Bun builds it as it serves it, and reloads the page as its files change.

```ts
// packages/newt-monitor/src/main.ts
  // In development its frontend comes from its sources, as Bun builds them; imported
  // only then, so production never builds it as it starts.
  const sources = config.frontendSources ? { frontend: (await import('../frontend/index.html')).default, development: true } : {}
  const app = runContexts([{ context: monitor, serve: { ...monitor.serving(), ...sources } }])
```

The root `bunfig.toml` gives that build Tailwind, as it gives cooper's.

## Its own project and its lint

The backend's project has no DOM. The frontend gets one of its own,
`tsconfig.newt-monitor-frontend.json`, which also checks the modules' `*.schema.ts`
with the browser's types: they are the contract the app shares with the API.

In `eslint.config.js` the backend keeps newt's lint, now on `bin`, `scripts` and
`src`, and the frontend gets `newt-react-ui`'s: pages compose components and style
nothing. Of the backend, the app imports only its modules' schemas, and only from its
API clients, in `frontend/api`.

## Check it

```sh
bun check
bun test packages/newt-monitor
bun run lint
bun run monitor:build
docker build -f monitor.Dockerfile -t newt-monitor .
```

```text
newt-monitor: 5 files in packages/newt-monitor/dist/frontend
```

## What to remember

- The monitor serves its own pages: one process, one address, no proxy.
- Built in production (`monitor:build`, `NEWT_MONITOR_FRONTEND`), from its sources in
  development (`bun run monitor`).
- Under `/api`, never the app; before the build, a 503 that says so.
