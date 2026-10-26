# AGENTS.md

Before writing code, read ../node_modules/newt/AGENTS.md: it is the rules of the
framework, versioned with it. What follows is this project's own.

## This project

cooper: boards of cards for teams, each team in a workspace of its own. newt's
example application, built step by step in its tutorial (web/guide).

## Contexts

In backend/contexts/, each with a database of its own. Which contexts each one uses
is said in the root's eslint.config.js, and the lint keeps it.

- boards: the boards of each workspace, their columns and cards. Uses none.

## Conventions

- Every context's base is a `CooperBase` (shared/cooper-base.ts); a module registers
  its routes on `base.http`, in its `<m>.routes.ts`.

## Commands

From the repository's root:

```sh
bun check          # types
bun test cooper    # cooper's tests
bun run lint       # newt's lint (eslint.config.js)
```
