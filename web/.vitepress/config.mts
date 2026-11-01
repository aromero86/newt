import { defineConfig, type DefaultTheme } from 'vitepress'
import { gruvboxDark, gruvboxLight } from './gruvbox'

type Page = [slug: string, title: string]

/** Part I: what everyone reads, in order, to build with newt. */
const ESSENTIALS: Page[] = [
  ['00-how-to-read', 'How to read this book'],
  ['01-why-newt', 'Why newt'],
  ['02-meet-cooper', 'Meet cooper'],
  ['03-contexts', 'Bounded contexts'],
  ['04-modules', 'Modules'],
  ['05-entities', 'Entities and their schemas'],
  ['06-use-cases', 'Use cases'],
  ['07-repositories', 'Repositories and stores'],
  ['08-http', 'Routes and the router'],
  ['09-events', 'Domain events'],
  ['10-workers', 'Workers and the outbox'],
  ['11-between-contexts', 'Contexts working together'],
  ['12-testing', 'Testing'],
  ['13-production', 'Running it in production'],
]

/** Part II: each chapter one subject, read when it is needed. */
const DEEPER: Page[] = [
  ['20-concurrency', 'Versions, conflicts and guards'],
  ['21-aggregates', 'Aggregates'],
  ['22-tenants', 'Tenants and scopes'],
  ['23-time', 'Time and schedules'],
  ['24-idempotency', 'Doing things once'],
  ['25-queries', 'Queries, analytics and ports'],
  ['26-stores', 'Stores and migrations'],
  ['27-security', 'HTTP security'],
  ['28-rate-limits', 'Rate limits'],
  ['29-auth', 'Auth, OAuth and web sessions'],
  ['30-frontends', 'Frontends'],
  ['31-mcp', 'An MCP server'],
  ['32-observability', 'Traces and metrics'],
  ['33-agents', 'Built for coding agents'],
]

/** Part III: the monitor every newt application gets. */
const MONITOR: Page[] = [
  ['40-monitor', 'newt-monitor'],
  ['41-connecting', 'Connecting an application'],
  ['42-structure', 'The structure, drawn'],
  ['43-metrics', 'Metrics'],
  ['44-traces', 'Traces'],
  ['45-queues', 'Queues and dead jobs'],
  ['46-asking-claude', 'Asking Claude'],
  ['47-running-the-monitor', 'Running the monitor'],
]

const APPENDICES: Page[] = [
  ['a-rules', 'A. The rules, and when newt throws'],
  ['b-lint', 'B. The lint'],
  ['c-cli', 'C. The command line'],
  ['d-exports', 'D. Every export'],
  ['e-problems', 'E. Common problems'],
]

const items = (pages: Page[]) => pages.map(([slug, text]) => ({ text, link: `/book/${slug}` }))

const sidebar: DefaultTheme.Sidebar = {
  '/book/': [
    { text: 'I. The essentials', items: items(ESSENTIALS) },
    { text: 'II. Going deeper', collapsed: false, items: items(DEEPER) },
    { text: 'III. The monitor', collapsed: false, items: items(MONITOR) },
    { text: 'Appendices', collapsed: true, items: items(APPENDICES) },
  ],
}

export default defineConfig({
  title: 'newt',
  description: 'A backend framework for Bun, with a monitor that sees everything it runs',
  cleanUrls: true,
  head: [['meta', { name: 'theme-color', content: '#427b58' }]],
  markdown: {
    theme: { light: gruvboxLight, dark: gruvboxDark },
    // A ```mermaid fence is a diagram, drawn in the browser in the page's theme.
    config(md) {
      const fence = md.renderer.rules.fence!
      md.renderer.rules.fence = (tokens, index, options, env, self) => {
        const token = tokens[index]!
        if (token.info.trim() !== 'mermaid') return fence(tokens, index, options, env, self)
        return `<Mermaid code="${encodeURIComponent(token.content)}" />`
      }
    },
  },
  themeConfig: {
    nav: [
      { text: 'The book', link: '/book/00-how-to-read', activeMatch: '/book/(0|1)' },
      { text: 'Going deeper', link: '/book/20-concurrency', activeMatch: '/book/(2|3)' },
      { text: 'Monitor', link: '/book/40-monitor', activeMatch: '/book/4' },
      { text: 'Appendices', link: '/book/a-rules', activeMatch: '/book/[a-e]-' },
    ],
    sidebar,
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/aromero86/newt' }],
  },
})
