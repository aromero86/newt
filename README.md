# newt

A backend framework for [Bun](https://bun.sh): bounded contexts made of modules, use cases,
entities and domain events with a transactional outbox, kept in stores you can swap or write.
And **newt-monitor**, which shows a newt application running in production in its own words:
its contexts, use cases, events, queues and traces, down to the last query.

**[Read the manual](https://aromero86.github.io/newt/manual/00-how-to-read)**: newt
explained through cooper, a real application, from the essentials to the monitor.

## Getting started

```sh
bun init -y
bun remove typescript                              # bun init's TypeScript 7: newt's lint runs on 6 for now
bun add @newt-kit/newt zod
bun add -d @newt-kit/eslint eslint typescript@npm:@typescript/typescript6@6.0.2
bunx @newt-kit/newt init                                 # AGENTS.md, CLAUDE.md and newt's lint
bunx @newt-kit/newt add module src/contexts/shop order   # a module's skeleton: compiles, passes the lint, has a test
```

`newt init` never overwrites a file: the `CLAUDE.md` that `bun init` wrote is left, and it
says the two lines to add to it so coding agents read newt's rules.

newt runs on Bun only (1.4 or later), and ships its TypeScript as it is: there is no build step.

## Packages

| Package | Folder | What it is |
|---|---|---|
| [`@newt-kit/newt`](https://www.npmjs.com/package/newt-kit) | [`packages/newt`](packages/newt) | The framework, one subpath per piece (`@newt-kit/newt/core`, `@newt-kit/newt/http`…), and its command line |
| [`@newt-kit/eslint`](https://www.npmjs.com/package/@newt-kit/eslint) | [`packages/newt-eslint`](packages/newt-eslint) | The lint of an application built with newt |
| [`@newt-kit/monitor`](https://www.npmjs.com/package/@newt-kit/monitor) | [`packages/newt-monitor`](packages/newt-monitor) | newt-monitor: watches newt applications as they run (`bunx @newt-kit/monitor`) |
| [`@newt-kit/react`](https://www.npmjs.com/package/@newt-kit/react) | [`packages/newt-react`](packages/newt-react) | What a React frontend thinks with: stores, services, forms, lists, the requests to a newt API |
| [`@newt-kit/react-ui`](https://www.npmjs.com/package/@newt-kit/react-ui) | [`packages/newt-react-ui`](packages/newt-react-ui) | The components of that frontend, and the lint that keeps an app from restyling them |

The rest of the repository: [`web`](web), the documentation site, its landing and the manual
(`bun run docs:dev`); and [`cooper`](cooper), the example application built on newt as any
would be: a small SaaS of boards and cards, its staff's backoffice and the OAuth server
they sign in with.

## Working on newt

```bash
bun install
bun run typecheck
bun run test
bun run lint                 # cooper, with @newt-kit/eslint and @newt-kit/react-ui's lint
bun run cooper               # cooper in development: one process, its frontends served from their sources
bun run cooper:seed          # cooper's demo data
bun run cooper:build         # cooper's three frontends, built for its backend to serve
```

cooper's backend serves three contexts, each on its own port: `auth` on 3001, `boards`
on 3002 and `backoffice` on 3003, and each serves its frontend beside its API: built
with Bun from @newt-kit/react-ui and @newt-kit/react, or, in development (`bun run cooper`),
from its sources, rebuilt as they change. What it keeps goes to `data/`. It imports
newt by its name (`@newt-kit/newt/runtime`), which the root `tsconfig.json` points at `packages/newt`.

Releases: [`RELEASING.md`](RELEASING.md). Security issues: [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © Angel Romero
