import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type UserConfig } from 'vite'

type CooperApp = {
  /** The app's folder name under cooper/frontend, and under dist/cooper once built. */
  name: 'auth' | 'boards' | 'backoffice'
  /** The dev server's port. */
  port: number
  /** The context's backend in dev, which the proxied paths go to. */
  backend: string
  /** Paths the dev server hands to the backend: the app reaches it through its own origin. */
  proxy: string[]
}

const libs = (name: string) => fileURLToPath(new URL(`../libs/${name}`, import.meta.url))

/**
 * What the three apps share: React, Tailwind, the aliases of cooper's libraries,
 * a fixed dev port that proxies to the app's context, and the build in
 * `dist/cooper/<name>`, which that context serves in production.
 */
export function cooperApp({ name, port, backend, proxy }: CooperApp): UserConfig {
  return defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@cooper/ui': libs('ui'),
        // The API client: the only way the frontend reaches the backend.
        '@cooper/api': libs('api'),
        '@cooper/core': libs('core'),
      },
    },
    server: {
      port,
      strictPort: true,
      proxy: Object.fromEntries(proxy.map(path => [path, backend])),
    },
    build: {
      outDir: fileURLToPath(new URL(`../../dist/cooper/${name}`, import.meta.url)),
      emptyOutDir: true,
    },
  })
}
