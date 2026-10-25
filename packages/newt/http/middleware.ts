import type { BunRequest } from 'bun'

/**
 * What runs before every route of a group, around it: it may answer instead (an
 * error, a redirect), or call `next` to go on, perhaps inside a scope of its own.
 *
 * ```ts
 * async (request, next) => workspace.run(await members.enter(request.params.workspaceId), next)
 * ```
 */
export type Middleware<Prefix extends string> = (request: BunRequest<Prefix>, next: () => Promise<Response>) => Response | Promise<Response>
