import { eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { AppCallFailed } from '../../../../shared/app-client/app-call-failed'
import type { Endpoint } from '../../../../shared/app-client/app-client'
import { App, AppListSchema, AppRegisterSchema, AppUpdateSchema, type AppDTO } from './app'
import type { App_Options } from './app-options'
import type { App_Deps } from './app.deps'
import { App_Repository } from './app.repository'
import { registerAppRoutes } from './app.routes'
import { AppDoesNotConnect } from './errors/app-does-not-connect'
import { AppNameTaken } from './errors/app-name-taken'
import { AppNotFound } from './errors/app-not-found'
import { App_Archived } from './events/app-archived'
import { App_Deleted } from './events/app-deleted'
import { App_Registered } from './events/app-registered'
import { App_Restored } from './events/app-restored'
import { App_Updated } from './events/app-updated'

/** The applications the monitor watches: their names, where to reach them, and their keys, sealed. */
export class App_Module extends Module {

  static initialize(base: MonitorBase, deps: App_Deps, options: App_Options): App_Module {
    const module = new App_Module(base, new App_Repository(base), deps, options)
    registerAppRoutes(base, module)
    return module
  }

  readonly events

  private constructor(base: MonitorBase, private readonly repo: App_Repository, private readonly deps: App_Deps, private readonly options: App_Options) {
    super('app', base.invocations, deps)
    this.events = eventsOf(base.bus, { registered: App_Registered, updated: App_Updated, archived: App_Archived, restored: App_Restored, deleted: App_Deleted })
  }

  /** Registers an application that answers at its address with its key: one that does not is not saved. */
  @UseCase()
  async register(input: unknown): Promise<AppDTO> {
    const fields = AppRegisterSchema.parse(input)
    if (await this.repo.isNameTaken(fields.name)) throw new AppNameTaken(fields.name)
    await this.connects(fields)
    const app = App.register(fields, this.options.cipher)
    await this.repo.persistWithNameFree(app)
    return app.toDTO()
  }

  /** A page of them, the newest first: those watched, unless `filter` asks for the archived ones, or all. */
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<AppDTO>> {
    const { status } = AppListSchema.parse(filter)
    const criteria = status === 'active' ? { archivedAt: null } : status === 'archived' ? { archivedAt: { ne: null } } : {}
    return mapPage(await this.repo.page(criteria, page, { newestFirst: true }), app => app.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<AppDTO> {
    return (await this.load(id)).toDTO()
  }

  /** One, or null if there is none: for a worker, whose application may be deleted since it was told. */
  @UseCase()
  async find(id: string): Promise<AppDTO | null> {
    return (await this.repo.first({ id }))?.toDTO() ?? null
  }

  /**
   * Changes its name, its address or its key: what is given and differs. A new address
   * or key must answer before it is saved: one that does not leaves the one that did.
   */
  @UseCase()
  async update(id: string, input: unknown): Promise<AppDTO> {
    const change = AppUpdateSchema.parse(input)
    const app = await this.load(id)
    if (change.name !== undefined && await this.repo.isNameTaken(change.name, id)) throw new AppNameTaken(change.name)
    if (change.url !== undefined || change.key !== undefined) {
      await this.connects({ url: change.url ?? app.url, key: change.key ?? app.key(this.options.cipher) })
    }
    app.update(change, this.options.cipher)
    await this.repo.persistWithNameFree(app)
    return app.toDTO()
  }

  @UseCase()
  async archive(id: string): Promise<AppDTO> {
    const app = await this.load(id)
    app.archive()
    await this.repo.persist(app)
    return app.toDTO()
  }

  @UseCase()
  async restore(id: string): Promise<AppDTO> {
    const app = await this.load(id)
    app.restore()
    await this.repo.persist(app)
    return app.toDTO()
  }

  /** For good: it must be archived first. What the other modules know of it goes too, as they hear `app.deleted`. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const app = await this.load(id)
    app.delete()
    await this.repo.persist(app)
  }

  /**
   * The ids of every application watched (not archived), for whatever goes through
   * them all, as the hourly refresh does. Whole, not a page: the applications one
   * monitor watches are counted in tens, by hand.
   */
  @UseCase()
  async watchedIds(): Promise<string[]> {
    return (await this.repo.find({ archivedAt: null })).map(app => app.id)
  }

  /**
   * Where an application is, and its key, opened: for the module that signs its
   * requests (`connection`). No route answers it.
   */
  @UseCase()
  async endpointOf(id: string): Promise<Endpoint> {
    const app = await this.load(id)
    return { url: app.url, key: app.key(this.options.cipher) }
  }

  /** Asks the endpoint which application it is, signing with the key: one that does not answer says why. */
  private async connects(endpoint: Endpoint): Promise<void> {
    try {
      await this.deps.client.identity(endpoint)
    } catch (error) {
      if (!(error instanceof AppCallFailed) || error.reason === 'key_unreadable') throw error
      throw new AppDoesNotConnect(error.reason, error.message)
    }
  }

  private load(id: string): Promise<App> {
    return this.resolve(() => this.repo.find({ id }), () => new AppNotFound(id))
  }
}
