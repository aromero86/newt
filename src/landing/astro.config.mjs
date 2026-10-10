import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Pages and components live at the project root: no nested src/.
  srcDir: '.',
  // Caches go to the monorepo's node_modules, like every other project.
  cacheDir: '../../node_modules/.astro/landing',
  outDir: '../../dist/landing',
  integrations: [react()],
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    cacheDir: '../../node_modules/.vite/landing',
    server: { strictPort: true },
    resolve: {
      alias: { '@newt/ui': fileURLToPath(new URL('../libs/ui', import.meta.url)) },
    },
  },
})
