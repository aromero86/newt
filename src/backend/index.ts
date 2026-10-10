const port = Number(process.env.API_PORT ?? 3000)

Bun.serve({
  port,
  fetch: () => new Response('Hello world'),
})

console.log(`Server listening on port ${port}`)
