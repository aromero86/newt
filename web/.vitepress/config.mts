import { defineConfig, type DefaultTheme } from 'vitepress'

/** The guide's chapters, in order: one slug, a title in each language. */
const CHAPTERS: [string, string, string][] = [
  ['00-introduction', 'Introduction', 'Introducción'],
  ['01-project-and-context', 'The project and a context', 'El proyecto y un contexto'],
  ['02-first-module', 'The first module: boards', 'El primer módulo: boards'],
  ['03-pages-and-errors', 'Use cases, pages and errors', 'Casos de uso, páginas y errores'],
  ['04-who-and-where', 'Who and where', 'Quién y dónde'],
  ['05-sqlite', 'From files to SQLite', 'De ficheros a SQLite'],
  ['06-rules-over-rows', 'Rules over rows', 'Reglas sobre filas'],
  ['07-cards-and-a-counter', 'Cards and a shared counter', 'Tarjetas y un contador compartido'],
  ['08-two-people-one-card', 'Two people, one card', 'Dos personas, una tarjeta'],
  ['09-idempotent-posts', 'Asking twice: idempotent POSTs', 'Preguntar dos veces: POST idempotentes'],
  ['10-events', 'Events', 'Eventos'],
  ['11-reacting', 'Reacting: handlers and the outbox', 'Reaccionar: handlers y el outbox'],
  ['12-failures', 'What cannot be undone, and failures', 'Lo que no se puede deshacer, y los fallos'],
  ['13-another-context', 'Listening to another context', 'Escuchar a otro contexto'],
  ['14-sagas', 'Sagas: a workspace comes and goes', 'Sagas: un workspace llega y se va'],
  ['15-kysely', 'Queries a table cannot say: Kysely', 'Consultas que una tabla no sabe decir: Kysely'],
  ['16-search-port', 'A search port of your own', 'Un puerto de búsqueda propio'],
  ['17-auth', 'A second context: auth', 'Un segundo contexto: auth'],
  ['18-tenants-and-access', 'Tenants and access', 'Tenants y acceso'],
  ['19-invitations-and-time', 'Invitations and time', 'Invitaciones y tiempo'],
  ['20-wiring-contexts', 'Wiring contexts together', 'Conectar los contextos'],
  ['21-oauth-server', 'An OAuth server', 'Un servidor OAuth'],
  ['22-web-session', 'Signing in to boards: the web session', 'Iniciar sesión en boards: la sesión web'],
  ['23-frontends', 'The frontends and newt/contract', 'Los frontends y newt/contract'],
  ['24-mcp-server', 'An MCP server', 'Un servidor MCP'],
  ['25-backoffice', 'A third context that reads two', 'Un tercer contexto que lee de dos'],
  ['26-dead-jobs-and-analytics', 'Dead jobs and analytics', 'Jobs muertos y analítica'],
  ['27-postgres', 'Postgres, MySQL and migrations in production', 'Postgres, MySQL y migraciones en producción'],
  ['28-observability', 'Observability', 'Observabilidad'],
  ['29-shipping', 'Shipping it', 'Ponerlo en producción'],
]

const APPENDICES: [string, string, string][] = [
  ['a-golden-rules', 'A. The golden rules', 'A. Las reglas de oro'],
  ['b-module-anatomy', 'B. A module\'s anatomy, and the lint', 'B. La anatomía de un módulo, y el lint'],
  ['c-common-problems', 'C. Common problems', 'C. Problemas comunes'],
  ['d-writing-a-store', 'D. Writing a store', 'D. Escribir un store'],
  ['e-index', 'E. Index of newt\'s exports', 'E. Índice de los exports de newt'],
  ['f-aggregates', 'F. Aggregates', 'F. Agregados'],
  ['g-command-line', 'G. The command line', 'G. La línea de comandos'],
  ['h-describe-application', 'H. What an application knows of itself', 'H. Lo que una aplicación sabe de sí misma'],
]

/** The monitor's guide: newt-monitor built with newt, chapter by chapter. */
const MONITOR: [string, string, string][] = [
  ['00-introduction', 'Introduction', 'Introducción'],
  ['01-a-monitor-built-with-newt', 'A monitor built with newt', 'Un monitor hecho con newt'],
  ['02-signing-in', 'Signing in', 'Entrar'],
  ['03-a-secret-that-encrypts', 'A secret that encrypts', 'Un secreto que cifra'],
  ['04-the-applications', 'The applications', 'Las aplicaciones'],
  ['05-archive-restore-delete', 'Archive, restore, delete', 'Archivar, restaurar, borrar'],
  ['06-talking-to-an-application', 'Talking to an application', 'Hablar con una aplicación'],
  ['07-not-saving-what-does-not-connect', 'Not saving what does not connect', 'No guardar lo que no conecta'],
]

const REFERENCE: [string, string, string][] = [
  ['rules', 'The framework\'s rules', 'Las reglas del framework'],
  ['stores', 'Stores', 'Stores'],
  ['lint', 'Lint', 'Lint'],
]

/** The sidebar of one language: `base` is '' for English, '/es' for Spanish. */
function sidebar(base: string, spanish: boolean): DefaultTheme.Sidebar {
  const items = (folder: string, pages: [string, string, string][]) =>
    pages.map(([slug, en, es]) => ({ text: spanish ? es : en, link: `${base}/${folder}/${slug}` }))
  return [
    { text: spanish ? 'Guía' : 'Guide', items: items('guide', CHAPTERS) },
    { text: spanish ? 'Apéndices' : 'Appendices', collapsed: true, items: items('guide', APPENDICES) },
    { text: spanish ? 'El monitor' : 'The monitor', collapsed: true, items: items('monitor', MONITOR) },
    { text: spanish ? 'Referencia' : 'Reference', items: items('reference', REFERENCE) },
  ]
}

export default defineConfig({
  title: 'newt',
  description: 'A backend framework for Bun',
  cleanUrls: true,
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [{ text: 'Guide', link: '/guide/00-introduction' }, { text: 'Monitor', link: '/monitor/00-introduction' }, { text: 'Reference', link: '/reference/rules' }],
        sidebar: sidebar('', false),
      },
    },
    es: {
      label: 'Español',
      lang: 'es',
      themeConfig: {
        nav: [{ text: 'Guía', link: '/es/guide/00-introduction' }, { text: 'Monitor', link: '/es/monitor/00-introduction' }, { text: 'Referencia', link: '/es/reference/rules' }],
        sidebar: sidebar('/es', true),
        outline: { label: 'En esta página' },
        docFooter: { prev: 'Anterior', next: 'Siguiente' },
      },
    },
  },
  themeConfig: {
    search: { provider: 'local' },
  },
})
