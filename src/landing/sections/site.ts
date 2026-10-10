import type { Bi } from '../i18n'

/** The page's own texts: what is not part of any section. */
export const site: Bi<{
  title: string
  description: string
  nav: { home: string; main: string; links: { href: string; label: string }[]; star: string; toLight: string; toDark: string }
  footer: { tagline: string; quickstart: string; backToTop: string; disclaimer: string }
}> = {
  en: {
    title: 'newt — the living definition of your product',
    description:
      "newt keeps your product's rules, entities and permissions in one living definition: versioned like code, never contradictory, and checked on every pull request.",
    nav: {
      home: 'newt home',
      main: 'Main',
      links: [
        { href: '#how', label: 'How it works' },
        { href: '#github', label: 'GitHub' },
        { href: '#roles', label: 'For your team' },
        { href: '#open-source', label: 'Open source' },
      ],
      star: 'Star on GitHub',
      toLight: 'Switch to light theme',
      toDark: 'Switch to dark theme',
    },
    footer: {
      tagline: 'The living definition of your product.',
      quickstart: 'Quickstart',
      backToTop: 'Back to top',
      disclaimer: 'newt is in early development. Screens on this page are design previews, not the final product.',
    },
  },
  es: {
    title: 'newt — la definición viva de tu producto',
    description:
      'newt guarda las rules, entities y permisos de tu producto en una única definición viva: versionada como el código, sin contradicciones y comprobada en cada pull request.',
    nav: {
      home: 'Inicio de newt',
      main: 'Principal',
      links: [
        { href: '#how', label: 'Cómo funciona' },
        { href: '#github', label: 'GitHub' },
        { href: '#roles', label: 'Para tu equipo' },
        { href: '#open-source', label: 'Open source' },
      ],
      star: 'Ver en GitHub',
      toLight: 'Cambiar a tema claro',
      toDark: 'Cambiar a tema oscuro',
    },
    footer: {
      tagline: 'La definición viva de tu producto.',
      quickstart: 'Empezar',
      backToTop: 'Volver arriba',
      disclaimer:
        'newt está en una fase temprana de desarrollo. Las pantallas de esta página son avances de diseño, no el producto final.',
    },
  },
}
