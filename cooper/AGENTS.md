# AGENTS.md

Before writing code, read ../node_modules/newt/AGENTS.md: it is the rules of the
framework, versioned with it. What follows is this project's own.

## This project

cooper: boards of cards for teams, each team in a workspace of its own. newt's
example application, built step by step in its tutorial (web/guide).

## Contexts

In backend/contexts/, each with a database of its own. Which contexts each one uses
is said in the root's eslint.config.js, and the lint keeps it.

- boards: the boards of each workspace, their columns and cards. Uses auth.
- auth: people, the workspaces (its tenants) and who may enter each, and how people
  sign in. Uses none.
- backoffice: what the staff see and do across the others. Uses auth and boards.

## Conventions

- Every context's base is a `CooperBase` (shared/cooper-base.ts); a module registers
  its routes on `base.http`, in its `<m>.routes.ts`.
- boards' repositories are scoped by workspace (contexts/boards/workspace-scope.ts).
- auth's repositories say `scope: 'none'`: people, sessions and tenants span
  workspaces, so its use cases ask who may see what.

## Commands

From the repository's root:

```sh
bun check          # types
bun test cooper    # cooper's tests
bun run lint       # newt's lint (eslint.config.js)
```
