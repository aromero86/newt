import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'newt',
  description: 'A backend framework for Bun',
  locales: {
    root: { label: 'English', lang: 'en' },
    es: { label: 'Español', lang: 'es' },
  },
})
