import 'newt-kit/core'

/**
 * How someone reached cooper: its web apps, with a session cookie, or an AI assistant
 * through boards' MCP server, with an access token.
 */
export type ActorVia = 'web' | 'mcp'

// newt knows one thing of the actor, its user. cooper adds how they came in, once,
// here: every program loads it through `CooperBase`. Required, so every place that
// says who acts says it too (`authenticateWith`, `runAsActor`): who someone is, never
// what they may do.
declare module 'newt-kit/core' {
  interface Actor {
    via: ActorVia
  }
}
