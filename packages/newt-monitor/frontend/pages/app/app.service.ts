import { computed } from '@preact/signals-core'
import { ApiError, inject, Store } from 'newt-react'
import { toast } from 'newt-react-ui/toast'
import { AppApi, type AppDTO } from '../../api/app'
import { CatalogApi, type CatalogItemDTO } from '../../api/catalog'
import { ConnectionApi, type ConnectionStatusDTO } from '../../api/connection'
import { StructureApi, type StructureVersionDTO } from '../../api/structure'

type AppState = {
  appId: string
  /** Undefined while it loads; null when there is no such application. */
  app: AppDTO | null | undefined
  connection: ConnectionStatusDTO | null
  /** Its last version; null until one is read. */
  structure: StructureVersionDTO | null
  failure: string | null
  checking: boolean
  refreshing: boolean
  /** Every part some version had and the last one has not; null until asked for. */
  removed: CatalogItemDTO[] | null
  /** Whether the explorer shows them, marked, beside what is there now. */
  showRemoved: boolean
}

/**
 * The application being shown: what it is, whether it answers and what it is made of,
 * as its last version says. Every tab of its page reads it from here.
 */
export class AppService {

  private readonly apps = inject(AppApi)
  private readonly connections = inject(ConnectionApi)
  private readonly structures = inject(StructureApi)
  private readonly catalog = inject(CatalogApi)
  private readonly store = new Store<AppState>({ appId: '', app: undefined, connection: null, structure: null, failure: null, checking: false, refreshing: false, removed: null, showRemoved: false })

  readonly app = this.store.select('app')
  readonly connection = this.store.select('connection')
  readonly structure = this.store.select('structure')
  readonly failure = this.store.select('failure')
  readonly checking = this.store.select('checking')
  readonly refreshing = this.store.select('refreshing')
  readonly removed = this.store.select('removed')
  readonly showRemoved = this.store.select('showRemoved')

  /** How many of each part its last version has. */
  readonly counts = computed(() => {
    const contexts = this.structure.value?.description.contexts ?? []
    const modules = contexts.flatMap(context => context.modules)
    return {
      contexts: contexts.length,
      modules: modules.length,
      useCases: modules.reduce((sum, module) => sum + module.useCases.length, 0),
      events: modules.reduce((sum, module) => sum + module.events.length, 0),
    }
  })

  get appId(): string {
    return this.store.value.appId
  }

  async load(appId: string): Promise<void> {
    this.store.patch({ appId, app: undefined, connection: null, structure: null, failure: null, removed: null })
    try {
      const [app, connection, structure] = await Promise.all([
        this.apps.app(appId),
        this.connections.status(appId),
        this.latest(appId),
      ])
      if (this.appId === appId) this.store.patch({ app, connection, structure })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ app: null })
      else this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the application' })
    }
  }

  /** The application as it is now: after a change of its settings, or its life. */
  replaced(app: AppDTO): void {
    this.store.patch({ app })
  }

  /** Asks it now whether it answers. */
  async check(): Promise<void> {
    this.store.patch({ checking: true })
    try {
      const connection = await this.connections.check(this.appId)
      this.store.patch({ connection })
      if (connection.status === 'up') toast.success('It answers')
      else toast.error(connection.failure?.message ?? 'It does not answer')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      this.store.patch({ checking: false })
    }
  }

  /** Reads its structure now: a new version only if it changed. */
  async refresh(): Promise<void> {
    this.store.patch({ refreshing: true })
    try {
      const result = await this.structures.refresh(this.appId)
      if (result.outcome === 'changed') toast.success('Its structure changed: a new version is kept')
      else if (result.outcome === 'unchanged') toast.success('Its structure is the same as the last version')
      else if (result.outcome === 'unreachable') toast.error(`It does not answer: ${result.failure.message}`)
      else if (result.outcome === 'archived') toast.error('It is archived: restore it to watch it again')
      const [connection, structure] = await Promise.all([this.connections.status(this.appId), this.latest(this.appId)])
      this.store.patch({ connection, structure, removed: null })
      // What a new version took away is in the catalog now.
      if (this.store.value.showRemoved) await this.loadRemoved()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      this.store.patch({ refreshing: false })
    }
  }

  /** What its versions had and the last one has not: asked for once, all of it. */
  async loadRemoved(): Promise<void> {
    if (this.store.value.removed !== null) return
    const appId = this.appId
    const removed: CatalogItemDTO[] = []
    let cursor: string | undefined
    try {
      do {
        const page = await this.catalog.list(appId, { status: 'archived' }, { size: 100, cursor })
        removed.push(...page.items)
        cursor = page.hasMore ? page.nextCursor ?? page.items.at(-1)?.id : undefined
      } while (cursor)
      if (this.appId === appId) this.store.patch({ removed })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  toggleRemoved(): void {
    this.store.patch({ showRemoved: !this.store.value.showRemoved })
  }

  /** Its last version, or null while none was read. */
  private latest(appId: string): Promise<StructureVersionDTO | null> {
    return this.structures.latest(appId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'structure.not_read') return null
      throw error
    })
  }
}
