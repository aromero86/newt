import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'newt',
  description: 'A backend framework for Bun',
  // While the guide is written in parts: removed once every page is in.
  ignoreDeadLinks: true,
  locales: {
    root: { label: 'English', lang: 'en' },
    es: { label: 'Español', lang: 'es' },
  },
})
