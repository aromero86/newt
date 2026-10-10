# newt

newt is the living definition of a product: what exists, who can do what and
what must always hold true, versioned like code and never contradictory. Product
changes are proposals, refined with Claude and approved delta by delta; a
proposal can only be accepted if it contradicts nothing in the definition.

Once accepted, a proposal is the brief for development. newt connects to GitHub so
that every pull request is checked against the product definition, product and
development each approve what they own, and product releases match code releases.

## Status

Early development. Today newt has accounts (sign up, sign in, profile, password
and password reset by email), private workspaces with members, admins and email
invitations, and the first part of a product's definition: its dimensions, its
areas and features, and its rules with their history, filtered by where they
apply. Rules are read-only for now: they will change through proposals, which
come next.

## Getting started

You need [Bun](https://bun.sh) and an SMTP server for the emails newt sends. Any
works; on your own machine a mail catcher such as Mailpit is the easiest.

```sh
bun install
bun run seed:env   # writes .env with every setting, keeping the ones already there
bun run dev        # backend, frontend and landing, all together
bun run seed:demo  # optional: Acme Shop, an example product, with a demo account
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:3000/api>
- Landing: <http://localhost:4321>

The database is a SQLite file (`data/newt.db` by default) and its migrations run
on their own when the backend starts.

## Settings

Every setting is an environment variable with a default; `bun run seed:env` writes
them to `.env`, each with a line saying what it is for.

| Variable | What it sets |
|---|---|
| `API_PORT` | Port of the backend |
| `NEWT_DB_PATH` | The SQLite database file |
| `NEWT_PUBLIC_URL` | Where people open newt: links in emails point there |
| `NEWT_SESSION_DAYS` | How long a session lasts |
| `NEWT_PASSWORD_RESET_MINUTES` | How long a password reset link works |
| `NEWT_INVITATION_DAYS` | How long a workspace invitation waits |
| `NEWT_SMTP_HOST`, `NEWT_SMTP_PORT`, `NEWT_SMTP_SECURE`, `NEWT_SMTP_USER`, `NEWT_SMTP_PASSWORD` | The SMTP server emails leave from |
| `NEWT_MAIL_FROM` | The sender of every email |

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Starts everything; stops everything if one part fails |
| `bun run typecheck` | Type-checks every project |
| `bun run lint` | Lints, including the rules that keep apps from styling on their own |
| `bun run test` | Runs the tests |
| `bun run build:frontend` | Builds the web app, which the backend then serves |
| `bun run build:landing` | Builds the landing page |
| `bun run migrate:up`, `migrate:down`, `migrate:status` | Applies, reverts or lists database migrations by hand |
| `bun run seed:env` | Writes or completes `.env` |
| `bun run seed:demo` | Loads Acme Shop, an example product, with the account `demo` / `acme-shop-demo` |

## Repository

One repository, one `package.json`:

```
src/
├── backend/       Bun: modules with one responsibility each, SQLite, HTTP under /api
├── frontend/      React 19 web app: dumb components, services with signals
├── landing/       the public landing page (Astro)
└── libs/
    ├── ui/        @newt/ui: the component library over shadcn, and the theme
    └── api/       @newt/api: the API client the frontend talks to the backend with
```

How each part is built is written for the agents that build it, in
[`docs/agents/`](docs/agents) and linked from [`AGENTS.md`](AGENTS.md).
