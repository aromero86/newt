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
apply. Every change to the definition is a proposal with a Markdown document, from
which a language model reads its deltas at each revision, approved delta by delta
and iterated in published revisions, like commits: what did not change keeps its
approval. Proposals have conversations, and accepted ones make up the planned
definition until they are marked as merged. Releases picture the definition in
force, show what changed since the last one, and export the specification and the
changelog as Markdown. Search finds areas, features, rules and proposals by their
words and by their meaning, in Spanish or English, with a model that runs inside
newt (downloaded the first time). AI assistants (Claude Code, Codex or any other
that speaks MCP) connect with a personal access token: they read the definition
and write and iterate proposals for you, never approve nor merge them.

## Getting started

You need [Bun](https://bun.sh) and an SMTP server for the emails newt sends. Any
works; on your own machine a mail catcher such as Mailpit is the easiest.

```sh
bun install
bun run seed:env   # writes .env with every setting, keeping the ones already there
bun run dev        # backend, frontend and landing, all together
bun run seed:demo  # optional: Acme Shop, an example product, with a demo account (run again to reset it)
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
| `NEWT_EMBEDDINGS_MODEL` | The model that finds things by their meaning (Hugging Face), downloaded the first time |
| `NEWT_MODELS_PATH` | Where downloaded models are kept |
| `NEWT_LLM_PROVIDER`, `NEWT_LLM_MODEL`, `NEWT_ANTHROPIC_API_KEY` | The language model that reads proposals' documents: `claude-cli` (Claude Code's `claude -p`, with this machine's session) or `anthropic-api` (with a key) |
| `NEWT_SMTP_HOST`, `NEWT_SMTP_PORT`, `NEWT_SMTP_SECURE`, `NEWT_SMTP_USER`, `NEWT_SMTP_PASSWORD` | The SMTP server emails leave from |
| `NEWT_MAIL_FROM` | The sender of every email |

## Scripts

| Script | What it does |
|---|---|
| `bun run dev` | Starts everything; stops everything if one part fails. With `--watch`, the backend restarts on every change |
| `bun run typecheck` | Type-checks every project |
| `bun run lint` | Lints, including the rules that keep apps from styling on their own |
| `bun run test` | Runs the tests |
| `bun run build:frontend` | Builds the web app, which the backend then serves |
| `bun run build:landing` | Builds the landing page |
| `bun run migrate:up`, `migrate:down`, `migrate:status` | Applies, reverts or lists database migrations by hand |
| `bun run seed:env` | Writes or completes `.env` |
| `bun run seed:demo` | Loads Acme Shop, an example product with proposals in every state, with the account `demo` / `acme-shop-demo`; run again, it overwrites Acme Shop and nothing else |

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
