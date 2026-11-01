// bun run ui: the gallery of @newt-kit/react-ui, served by Bun from its sources, reloaded as they change.
import gallery from './index.html'

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4900),
  routes: { '/': gallery },
  development: { hmr: true, console: true },
})
console.log(`@newt-kit/react-ui's gallery on ${server.url}`)
