import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { Clock } from 'newt/core'
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

  /** Opened after `auth`, which it uses; on the real time, unless a test gives it a `clock`. */
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, clock?: Clock): Promise<Boards_Context> {
    // Brought up to date as it opens: the migrations it has not run yet, in order.
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new BoardsBase({ name: 'boards', store, clock })
    const modules = initializeModules(base, config, deps)
    // The cards' search starts empty in memory: every card is indexed before anyone searches.
    await modules.card.reindex()
    return new Boards_Context(base, modules, config, deps.auth)
  }

  /** Its MCP server beside the API: `/mcp`, and the metadata that says how to sign in to it. */
  protected override routes(): Bun.Serve.Routes<undefined, string> {
    return { ...super.routes(), ...mcpRoutes(this.modules, this.auth, { publicUrl: this.config.publicUrl, authPublicUrl: this.config.authPublicUrl }) }
  }
}
