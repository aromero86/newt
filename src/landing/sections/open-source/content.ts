import type { Bi } from '../../i18n'
import type { RoadmapCopy } from '../../ui/scenes/open-source/status'
import type { QuickstartCopy } from '../../ui/scenes/open-source/quickstart'

/** Every text of the open-source section, in both languages. */
export const content: Bi<{
  eyebrow: string
  title: string
  lead: string
  /** In order: self-hosted, Claude-native, GitHub App, bootstraps from your code. */
  pillars: { title: string; text: string }[]
  roadmap: RoadmapCopy
  quickstart: QuickstartCopy
  cta: { title: string; highlight: string; text: string; star: string; how: string }
}> = {
  en: {
    eyebrow: 'Open source',
    title: 'Built in the open. Yours to run.',
    lead: 'newt is being built in the open, phase by phase, starting with our own products. Follow along, try it early, and tell us where it breaks.',
    pillars: [
      {
        title: 'Self-hosted',
        text: 'Your product definition is your company’s knowledge. Run newt on your own server; your data stays with you.',
      },
      {
        title: 'Claude-native',
        text: 'newt speaks MCP. Product, support and developers work with it from Claude, in plain language.',
      },
      {
        title: 'GitHub App',
        text: 'Checks on every pull request, proposals linked to PRs, product releases synced with your GitHub releases.',
      },
      {
        title: 'Bootstraps from your code',
        text: 'Point it at an existing repository and Claude drafts the definition your code already follows, for your team to review.',
      },
    ],
    roadmap: {
      title: 'Where we are',
      text: 'Eight stages, each one usable on its own. We review every phase before starting the next.',
      stages: [
        { name: 'Foundations', text: 'Repository, web shell, users' },
        { name: 'Define a product', text: 'Rules, proposals, deltas, releases' },
        { name: 'Claude', text: 'Proposals by conversation, first bootstrap' },
        { name: 'The gate', text: 'Nothing contradictory is accepted' },
        { name: 'Full model', text: 'Entities, lifecycles, actors, parameters' },
        { name: 'Bugs & board', text: 'Known bugs, monitoring, support' },
        { name: 'The team', text: 'Notifications, internal deployment' },
        { name: 'The code', text: 'GitHub App, PR checks, agents' },
      ],
      inProgress: 'in progress',
    },
    quickstart: {
      title: 'Quickstart',
      badge: 'preview: not runnable yet',
      text: 'What getting started will look like. Star the repository to know when the first release is out.',
      copy: 'Copy commands',
      commands: `# coming with the first release
git clone <repo> newt && cd newt
bun install && bun run dev

# connect Claude to your newt
claude mcp add newt -- newt mcp`,
    },
    cta: {
      title: 'Stop guessing how your product ',
      highlight: 'should behave.',
      text: 'One living definition for product, support, QA, sales and the code. Versioned, coherent, and checked on every pull request.',
      star: 'Star on GitHub',
      how: 'See how it works',
    },
  },
  es: {
    eyebrow: 'Open source',
    title: 'Hecho en abierto. Tuyo para usarlo.',
    lead: 'newt se está construyendo en abierto, fase a fase, empezando por nuestros propios productos. Síguelo, pruébalo pronto y cuéntanos dónde falla.',
    pillars: [
      {
        title: 'En tus servidores',
        text: 'La definición de tu producto es el conocimiento de tu empresa. Ejecuta newt en tu propio servidor: tus datos se quedan contigo.',
      },
      {
        title: 'Hecho para Claude',
        text: 'newt habla MCP. Producto, soporte y desarrollo trabajan con él desde Claude, en lenguaje natural.',
      },
      {
        title: 'App de GitHub',
        text: 'Comprobaciones en cada pull request, proposals enlazadas a PRs y releases de producto sincronizadas con las de GitHub.',
      },
      {
        title: 'Arranca desde tu código',
        text: 'Apúntalo a un repositorio existente y Claude redacta la definición que tu código ya cumple, para que tu equipo la revise.',
      },
    ],
    roadmap: {
      title: 'Dónde estamos',
      text: 'Ocho etapas, cada una útil por sí sola. Revisamos cada fase antes de empezar la siguiente.',
      stages: [
        { name: 'Cimientos', text: 'Repositorio, esqueleto web, usuarios' },
        { name: 'Definir un producto', text: 'Rules, proposals, deltas, releases' },
        { name: 'Claude', text: 'Proposals conversando, primer arranque' },
        { name: 'La puerta', text: 'No se acepta nada contradictorio' },
        { name: 'Modelo completo', text: 'Entities, lifecycles, actors, parameters' },
        { name: 'Bugs y board', text: 'Bugs conocidos, monitorización, soporte' },
        { name: 'El equipo', text: 'Avisos, despliegue interno' },
        { name: 'El código', text: 'App de GitHub, checks en PRs, agentes' },
      ],
      inProgress: 'en marcha',
    },
    quickstart: {
      title: 'Cómo empezar',
      badge: 'avance: aún no funciona',
      text: 'Así será empezar. Dale una estrella al repositorio para enterarte cuando salga la primera release.',
      copy: 'Copiar comandos',
      commands: `# llegará con la primera release
git clone <repo> newt && cd newt
bun install && bun run dev

# conecta Claude a tu newt
claude mcp add newt -- newt mcp`,
    },
    cta: {
      title: 'Deja de adivinar cómo ',
      highlight: 'debe comportarse tu producto.',
      text: 'Una única definición viva para producto, soporte, QA, ventas y el código. Versionada, coherente y comprobada en cada pull request.',
      star: 'Ver en GitHub',
      how: 'Mira cómo funciona',
    },
  },
}
