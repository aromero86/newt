# Against cooper

Every test so far asked an application built for the test. This chapter asks cooper:
cooper started as it runs in production, in a process of its own, with its monitor
endpoint on; the monitor registers it, finds it answers, reads what it is made of and
catalogues it. Then the monitor gets its image, so it runs beside cooper, and its
command, so it runs anywhere.

At the end you will have these files:

```
package.json                          changed: newt-monitor, so `bunx newt-monitor` runs it
Dockerfile                            changed: the monitor's package.json
docs.Dockerfile                       changed: the same
monitor.Dockerfile                    the monitor's image
packages/newt-monitor/
  README.md                           what it is, how it runs, its API
  src/against-cooper.test.ts          the monitor, against cooper
```

## cooper, as it runs

cooper serves its monitor endpoint when it is given a key
([appendix H of the guide](../guide/h-describe-application)): `COOPER_MONITOR_KEY`, on
`COOPER_MONITOR_PORT`. The test starts it as a process, every database in memory and
every port free, and waits until it says the endpoint listens:

```ts
// packages/newt-monitor/src/against-cooper.test.ts
  cooper = Bun.spawn(['bun', 'cooper/backend/index.ts'], {
    cwd: ROOT,
    stdout: 'pipe',
    env: {
      ...process.env,
      COOPER_AUTH_PORT: String(freePort()),
      COOPER_BOARDS_PORT: String(freePort()),
      COOPER_BACKOFFICE_PORT: String(freePort()),
      COOPER_AUTH_DATABASE: ':memory:',
      COOPER_BOARDS_DATABASE: ':memory:',
      COOPER_BACKOFFICE_DATABASE: ':memory:',
      COOPER_MONITOR_KEY: COOPER_KEY,
      COOPER_MONITOR_PORT: String(port),
    },
  })
```

The monitor imports nothing of cooper: it reaches it over HTTP, signing each request,
as it reaches any application.

## What it finds

```ts
// packages/newt-monitor/src/against-cooper.test.ts
    const structure = await (await as(`/api/apps/${id}/structure`)).json() as StructureVersionDTO
    expect(structure.description.contexts.map(context => [context.name, context.uses])).toEqual([['auth', []], ['boards', ['auth']], ['backoffice', ['auth', 'boards']]])
```

The contexts cooper is made of, each with those it uses: what newt-eslint's
`contexts.uses` declares, found while it runs. Its catalog has `boards/card.create`, and
auth's nightly schedule with its cron. And cooper refuses any other key: nothing is
saved.

## The image

The monitor's image installs the workspace and copies only newt and the monitor:

```
# monitor.Dockerfile
COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
COPY packages/newt-graph/package.json packages/newt-graph/
COPY packages/newt-monitor/package.json packages/newt-monitor/
RUN bun install --frozen-lockfile --production

COPY packages/newt packages/newt
COPY packages/newt-monitor packages/newt-monitor

ENV NODE_ENV=production
ENV NEWT_MONITOR_DATA=/app/data/newt-monitor.db
EXPOSE 4800
CMD ["bun", "packages/newt-monitor/bin/newt-monitor.ts"]
```

`bun install --frozen-lockfile` needs every workspace's `package.json`: a new package
in `packages/` is one more line in every image of the repository, cooper's and the
docs' too, or their next build fails.

Its database is in `/app/data`: a persistent volume. Without its user, password and
secret, it does not start:

```
newt-monitor: it cannot start:
  NEWT_MONITOR_USER: Invalid input: expected string, received undefined
  NEWT_MONITOR_PASSWORD: Invalid input: expected string, received undefined
  NEWT_MONITOR_SECRET: Invalid input: expected string, received undefined
```

## Beside cooper

On the same network as cooper (Coolify's, for one), the monitor reaches cooper's
endpoint by its name on that network, on a port no public address points at
(`http://cooper:3010`). The monitor has a domain of its own, so its admin can sign in;
cooper's endpoint has none.

## The command

The repository depends on the package (`"newt-monitor": "workspace:*"`), so its command
is there:

```sh
NEWT_MONITOR_USER=ana NEWT_MONITOR_PASSWORD='a long password' \
NEWT_MONITOR_SECRET="$(openssl rand -base64 48)" bunx newt-monitor
```

## Check it

```sh
bun check
bun test
bun run lint
bun run docs:check
docker build -f monitor.Dockerfile -t newt-monitor .
```

## What the monitor is now

An application built with newt, of one context and five modules, which watches others
without ever opening their data:

| Module | Its one responsibility |
|---|---|
| `session` | Who is in: one user, a session in a cookie. |
| `app` | The applications: where they are, their keys sealed, their life. |
| `connection` | Talking to each one, signed, and whether it answers. |
| `structure` | What each one is made of, a version each time it changes. |
| `catalog` | Every part any version had, when it came and when it went. |

Next: [its pages](./13-its-pages).

## What to remember

- Test against the real thing once, end to end, as it runs: its own process, over the
  network.
- A new workspace package is a line in every image of the repository.
- A monitor endpoint has no public address; the monitor has one, behind its sign-in.
