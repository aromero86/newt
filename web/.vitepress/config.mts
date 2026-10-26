import { defineConfig, type DefaultTheme } from 'vitepress'

/** The guide's chapters, in order: one slug, a title in each language. */
const CHAPTERS: [string, string, string][] = [
  ['00-introduction', 'Introduction', 'Introducción'],
  ['01-the-project', 'The project', 'El proyecto'],
  ['02-a-context', 'A context and its base', 'Un contexto y su base'],
  ['03-first-module', 'Your first module: boards', 'Tu primer módulo: los tableros'],
  ['04-use-cases', 'Use cases with judgement', 'Casos de uso con criterio'],
  ['05-who-and-where', 'Who and where', 'Quién y dónde'],
  ['06-transactions', 'Transactions', 'Transacciones'],
  ['07-concurrency', 'Two people, one card', 'Dos personas, una card'],
  ['08-rules-over-rows', 'Rules over several rows', 'Reglas sobre varias filas'],
  ['09-shared-counters', 'Values everyone changes', 'Valores que todos cambian'],
  ['10-events', 'Events', 'Eventos'],
  ['11-reacting', 'Reacting to an event', 'Reaccionar a un evento'],
  ['12-eventual-consistency', 'Eventual consistency', 'Consistencia eventual'],
  ['13-repeatable-workers', 'Workers that can repeat', 'Workers que se pueden repetir'],
  ['14-irreversible', 'The irreversible leaves from a worker', 'Lo irreversible sale de un worker'],
  ['15-failures', 'When something fails', 'Cuando algo falla'],
  ['16-sagas', 'Failing halfway', 'Fallar a mitad'],
  ['17-modules-talk', 'Modules that talk', 'Módulos que hablan entre sí'],
  ['18-references', 'References between modules', 'Referencias entre módulos'],
  ['19-several-contexts', 'Several contexts', 'Varios contextos'],
  ['20-oauth-server', 'An OAuth server', 'Un servidor OAuth'],
  ['21-mcp-server', 'An MCP server', 'Un servidor MCP'],
  ['22-backoffice', 'The backoffice', 'El backoffice'],
  ['23-search', 'Searching', 'Búsquedas'],
  ['24-migrations', 'Migrations', 'Migraciones'],
  ['25-tests', 'Tests', 'Tests'],
  ['26-production', 'In production', 'En producción'],
]

const APPENDICES: [string, string, string][] = [
  ['a-golden-rules', 'A. The golden rules', 'A. Las reglas de oro'],
  ['b-module-anatomy', 'B. A module\'s anatomy', 'B. Anatomía de un módulo'],
  ['c-common-problems', 'C. Common problems', 'C. Problemas frecuentes'],
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
        nav: [{ text: 'Guide', link: '/guide/00-introduction' }, { text: 'Reference', link: '/reference/rules' }],
        sidebar: sidebar('', false),
      },
    },
    es: {
      label: 'Español',
      lang: 'es',
      themeConfig: {
        nav: [{ text: 'Guía', link: '/es/guide/00-introduction' }, { text: 'Referencia', link: '/es/reference/rules' }],
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
