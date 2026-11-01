# newt-kit-react-ui

The components of a React frontend of a newt application, and the lint that keeps an
app from restyling them: pages compose these components, an app's own components wrap
them, and nothing else styles.

```sh
bun add newt-kit-react-ui
bunx newt-kit init   # adds its rules to CLAUDE.md, and its skill to .claude/skills
```

What there is and how an app uses it: [AGENTS.md](./AGENTS.md). Its components as an
app sees them: `bun run ui` in newt's repository.

Tailwind 4 builds its styles: with Bun, `bun-plugin-tailwind` (`bunfig.toml`); with
Vite, `@tailwindcss/vite`. The app's stylesheet imports `newt-kit-react-ui/theme.css`.
