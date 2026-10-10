import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  outDir: '../../dist/landing',
  integrations: [react()],
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: { strictPort: true },
    resolve: {
      alias: { '@newt/ui': fileURLToPath(new URL('../libs/ui', import.meta.url)) },
    },
  },
})
