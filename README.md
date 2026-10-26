# newt

A backend framework for Bun: bounded contexts made of modules, use cases, entities
and domain events with a transactional outbox, kept in stores you can swap or write.

| Folder | What it holds |
|---|---|
| [`packages/newt`](packages/newt) | The framework, published as `newt`, one subpath per piece (`newt/core`…) |
| [`packages/newt-eslint`](packages/newt-eslint) | The lint of an application built with newt |
| [`web`](web) | The documentation site, in English and Spanish: [the guide](web/guide/00-introduction.md), which builds cooper step by step, and [the reference](web/reference/rules.md) (`bun run docs:dev`) |
| [`cooper`](cooper) | The example application built on it as any would be: a small Trello-like SaaS, its staff's backoffice and the OAuth server they sign in with |

```bash
bun install
bun run typecheck
bun run test
bun run lint                 # cooper, with newt-eslint and its frontend rules
bun run cooper               # cooper in development: its backend and its three frontends
bun run cooper:seed          # cooper's demo data
bun run cooper:build         # cooper's three frontends, built for its backend to serve
```

cooper's backend serves three contexts, each on its own port: `auth` on 3001, `boards`
on 3002 and `backoffice` on 3003; in development their frontends run on Vite, at
5171, 5172 and 5173. What it keeps goes to `data/`. It imports newt by its name
(`newt/runtime`), which the root `tsconfig.json` points at `packages/newt`.
