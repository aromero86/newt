---
layout: home
hero:
  name: newt
  text: A backend framework for Bun
  tagline: Bounded contexts, use cases, entities and domain events with a transactional outbox, in stores you can swap.
  actions:
    - theme: brand
      text: Build cooper, step by step
      link: /guide/00-introduction
    - theme: alt
      text: Reference
      link: /reference/rules
features:
  - title: Rules the machine checks
    details: A use case writes to its own module, one module per transaction, a save that reads rows takes a guard. newt refuses the rest at runtime, and its lint before you run.
    link: /guide/b-module-anatomy
    linkText: The anatomy and the lint
  - title: Saves you can trust
    details: Every row has a version; two people changing one thing never lose a change. A conflict runs the use case again on its own, and a rule over several rows holds on every store.
    link: /guide/08-two-people-one-card
    linkText: Two people, one card
  - title: Events that are never lost
    details: An event is written in the same transaction as the change that tells it. A worker runs each reaction until it succeeds, with retries, backoff and dead jobs you can retry.
    link: /guide/11-reacting
    linkText: The outbox
  - title: Stores you can swap
    details: SQLite, plain files, Postgres and MySQL behind one port. Modules never know which one; a contract suite proves a store of your own keeps every promise.
    link: /guide/05-sqlite
    linkText: From files to SQLite
  - title: Time you can move
    details: One clock per context drives timestamps, jobs and schedules. A cron fires once even with several processes, and a test moves the clock instead of waiting.
    link: /guide/19-invitations-and-time
    linkText: Invitations and time
  - title: HTTP that is closed by default
    details: Every route needs a session unless it says otherwise. CORS, idempotent POSTs, OAuth-style errors, health that answers 503 while the server drains.
    link: /guide/09-idempotent-posts
    linkText: Asking twice
  - title: Ready for coding agents
    details: newt ships an AGENTS.md versioned with the code. newt init points an application's agents at it; newt add module writes a module the lint already accepts.
    link: /guide/g-command-line
    linkText: The command line
  - title: Your system, drawn
    details: newt-graph reads an application and draws its contexts, modules, use cases and events. Pick a use case and watch its side effects travel, worker after worker.
    link: /guide/g-command-line
    linkText: newt-graph
  - title: Your system, watched
    details: newt-monitor watches running newt applications, never their data. Each one tells it what it is made of, to requests signed with a key that never travels; it keeps every version, and when each part came and went.
    link: /monitor/00-introduction
    linkText: Build the monitor
  - title: Learn it by building
    details: Thirty chapters build cooper, a small Trello with an OAuth server, an MCP server and a backoffice. Each chapter ends at a git tag that runs and passes its tests.
    link: /guide/00-introduction
    linkText: Start
---
