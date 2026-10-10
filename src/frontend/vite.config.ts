import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiPort = Number(process.env.API_PORT ?? 3000)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@newt/ui': fileURLToPath(new URL('../libs/ui', import.meta.url)),
      // The API client: the only way the frontend reaches the backend.
      '@newt/api': fileURLToPath(new URL('../libs/api', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The frontend reaches the backend through its own origin.
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  build: { outDir: '../../dist/frontend', emptyOutDir: true },
})
