/**
 * Who is doing what is being done. The framework only knows the user; an application
 * adds what it needs by augmenting this interface, once:
 *
 * ```ts
 * declare module 'newt-kit/core' {
 *   interface Actor {
 *     sessionId: string | null
 *   }
 * }
 * ```
 */
export interface Actor {
  userId: string
}
