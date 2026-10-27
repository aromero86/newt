# The monitor

newt-monitor watches newt applications while they run: which contexts each one has,
their modules, their use cases and their events, and how that changes from one
deployment to the next. It is a newt application itself, and this guide builds it,
chapter by chapter, as [the guide](../guide/00-introduction) builds cooper.

It never opens an application's database. Each application tells it what it is
made of, through `newt/monitor` ([appendix H](../guide/h-describe-application)): an
endpoint on a port of its own, that answers only requests signed with a key both
share. The key never travels.

## What it does when it is built

- One person signs in to it, with a user and a password from its environment.
- It keeps the applications it watches: a name, where their monitor endpoint is and
  their key, encrypted with a secret of its own. An application is archived before it
  can be deleted, and deleting it takes everything known of it.
- It talks to each one, signing every request, and knows whether it answers.
- Every hour, or when asked, it reads each one's structure, and keeps a version each
  time it changes.
- Its catalog keeps every context, module, use case and event any version had: when
  it first appeared, when it was last seen, and when it went.

There is no screen yet: these chapters build its API. Its pages come after.

## How the guide works

Each chapter takes newt-monitor to a tag, `monitor/NN`: its code at the end of the
chapter, which every block of it shows (`// packages/newt-monitor/…`). Check one out
to start from there:

```sh
git checkout monitor/04
```

It builds on what [the guide](../guide/00-introduction) teaches: contexts, modules,
entities, use cases, events and workers, schedules. Each chapter says which part of
newt it uses, and points at the chapter of the guide that teaches it.

## The chapters

1. [A monitor built with newt](./01-a-monitor-built-with-newt): the package, its
   context, its settings, and `bunx newt-monitor`.
2. [Signing in](./02-signing-in): one user and a password, a session in a cookie.

Next: [a monitor built with newt](./01-a-monitor-built-with-newt).
