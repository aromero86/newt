# newt-monitor

Watches newt applications while they run: which contexts each one has, their modules,
their use cases and their events, and how that changes from one deployment to the next.
It never opens an application's database: each one tells it what it is made of,
through `newt/monitor`, on a port of its own, to requests signed with a key both share.

It is a newt application itself. How to use it, and how it is built, is part III of
the newt manual, `web/manual/40-monitor.md`.

## Running it

```sh
NEWT_MONITOR_USER=ana \
NEWT_MONITOR_PASSWORD='a long password' \
NEWT_MONITOR_SECRET="$(openssl rand -base64 48)" \
bunx newt-monitor
```

| Variable | What it is |
|---|---|
| `NEWT_MONITOR_USER`, `NEWT_MONITOR_PASSWORD` | Who signs in: one person. Required; the password has 12 characters or more. |
| `NEWT_MONITOR_SECRET` | What the applications' keys are encrypted with. Required, 32 characters or more. Lose it, and every key must be given again. |
| `NEWT_MONITOR_PORT` | Where it listens: 4800. |
| `NEWT_MONITOR_DATA` | Its SQLite database: `data/newt-monitor.db`. |
| `NEWT_MONITOR_PUBLIC_URL` | Where it is opened: its cookie is `Secure` when this is `https`. |
| `NEWT_MONITOR_SESSION_HOURS` | How long a session lasts: 12. |
| `NEWT_MONITOR_FRONTEND` | Its built pages: the package's `dist/frontend`. |

Without a user, a password or a secret, it does not start, and says which are missing.

In a container: `monitor.Dockerfile`, at the repository's root, with `/app/data` a
persistent volume.

Its pages are built first, with `bun run monitor:build` at the repository's root (the
image does it). In development, `bun run monitor` serves them from their sources and
reloads them as they change.

## Watching an application

The application serves its monitor endpoint (`serveMonitor`, `newt/monitor`) with a key
of 32 characters or more, on a port no public address points at. Register it with
that address and key: the monitor asks it which application it is before it saves
anything.

```sh
curl -s -b cookies.txt localhost:4800/api/apps -H 'content-type: application/json' \
  -d '{"name":"cooper","url":"http://cooper:3010","key":"…"}'
```

## Its API

Every route needs the session, but signing in.

| Route | What it does |
|---|---|
| `POST /api/session`, `GET /api/session`, `DELETE /api/session` | Sign in, who is in, sign out. |
| `GET /api/apps?status=active\|archived\|all`, `POST /api/apps` | The applications; register one. |
| `GET /api/apps/:id`, `PATCH /api/apps/:id` | One; change its name, address or key (checked first). |
| `POST /api/apps/:id/archive`, `POST /api/apps/:id/restore`, `DELETE /api/apps/:id` | Its life: deleted only once archived, and then everything of it. |
| `GET /api/apps/:id/connection`, `POST /api/apps/:id/connection/check` | Whether it answers, and who. |
| `GET /api/apps/:id/structure`, `POST /api/apps/:id/structure/refresh` | Its structure now; read it now (it is read every hour too). |
| `GET /api/apps/:id/structure/versions`, `GET /api/apps/:id/structure/versions/:versionId` | Every version, each time it changed. |
| `GET /api/apps/:id/catalog?kind=&context=&module=&status=`, `GET /api/apps/:id/catalog/:itemId` | Every part any version had: when it came, when it was last there, when it went. |
