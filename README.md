# newt

A backend framework for Bun: bounded contexts made of modules, use cases, entities
and domain events with a transactional outbox, kept in stores you can swap or write.

| Folder | What it holds |
|---|---|
| [`packages/newt`](packages/newt) | The framework, published as `newt`, one subpath per piece (`newt/core`…) |
| [`packages/newt-eslint`](packages/newt-eslint) | The lint of an application built with newt |
| [`packages/newt-react-ui`](packages/newt-react-ui) | The components of a newt application's React frontend, and the lint that keeps an app from restyling them |
| [`packages/newt-react`](packages/newt-react) | What that frontend thinks with: stores, services, forms, lists, the requests to a newt API |
| [`web`](web) | The documentation site: a landing and [the newt book](web/book/00-how-to-read.md), which explains newt through cooper, from the essentials to newt-monitor (`bun run docs:dev`) |
| [`cooper`](cooper) | The example application built on it as any would be: a small Trello-like SaaS, its staff's backoffice and the OAuth server they sign in with |

```bash
bun install
bun run typecheck
bun run test
bun run lint                 # cooper, with newt-eslint and newt-react-ui's lint
bun run cooper               # cooper in development: one process, its frontends served from their sources
bun run cooper:seed          # cooper's demo data
bun run cooper:build         # cooper's three frontends, built for its backend to serve
```

cooper's backend serves three contexts, each on its own port: `auth` on 3001, `boards`
on 3002 and `backoffice` on 3003, and each serves its frontend beside its API: built
with Bun from newt-react-ui and newt-react, or, in development (`bun run cooper`),
from its sources, rebuilt as they change. What it keeps goes to `data/`. It imports
newt by its name (`newt/runtime`), which the root `tsconfig.json` points at `packages/newt`.
