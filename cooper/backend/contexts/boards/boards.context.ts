import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Tracer } from 'newt/core'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_Auth, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'
import { mcpRoutes } from './mcp/mcp'

/**
 * The SaaS: each workspace's boards, their columns and cards, on the web and through
 * MCP. Its people sign in through `auth`, which also keeps the workspaces and who
 * belongs to each: `boards` asks it through ports it is handed when it opens, and
 * calls its use cases.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config, private readonly auth: Boards_Auth) {
    super('boards', base, config)
  }

  /** Opened after `auth`, which it uses; watched by `tracer`, if one is given (ch. 30). */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, tracer?: Tracer): Promise<Boards_Context> {
    const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
    const base = new BoardsBase({ name: 'boards', store, tracer })
    return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
  }

  /** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
  }
}
