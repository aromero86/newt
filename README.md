# newt

A backend framework for Bun: bounded contexts made of modules, use cases, entities
and domain events with a transactional outbox, kept in stores you can swap or write.

| Folder | What it holds |
|---|---|
| [`packages/newt`](packages/newt) | The framework, published as `newt`, one subpath per piece (`newt/core`…) |
| [`packages/newt-eslint`](packages/newt-eslint) | The lint of an application built with newt |
| [`docs`](docs) | [The guide](docs/guide.md), [stores](docs/stores.md) and [the manual, in Spanish](docs/manual.es.md) |
| [`examples`](examples) | Applications built on it as any would be: [`notes`](examples/notes), the smallest, and [`despensa`](examples/despensa), a shop |

```bash
bun install
bun run typecheck
bun run test
bun run lint                 # the examples, with newt-eslint
bun examples/notes/main.ts   # the notes application, on port 3000
```

The examples serve their routes under `/api`, and take who is asking from an `x-user`
header: `curl -H 'x-user: ana' localhost:3000/api/notes`. What they keep goes to `data/`.
