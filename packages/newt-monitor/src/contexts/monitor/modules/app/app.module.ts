import { eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import type { Endpoint } from '../../../../shared/app-client/app-client'
import { App, AppListSchema, AppRegisterSchema, AppUpdateSchema, type AppDTO } from './app'
import type { App_Options } from './app-options'
import { App_Repository } from './app.repository'
import { registerAppRoutes } from './app.routes'
import { AppNameTaken } from './errors/app-name-taken'
import { AppNotFound } from './errors/app-not-found'
import { App_Archived } from './events/app-archived'
import { App_Deleted } from './events/app-deleted'
import { App_Registered } from './events/app-registered'
import { App_Restored } from './events/app-restored'
import { App_Updated } from './events/app-updated'

/** The applications the monitor watches: their names, where to reach them, and their keys, sealed. */
export class App_Module extends Module {

  static initialize(base: MonitorBase, options: App_Options): App_Module {
    const module = new App_Module(base, new App_Repository(base), options)
    registerAppRoutes(base, module)
    return module
  }

  readonly events

  private constructor(base: MonitorBase, private readonly repo: App_Repository, private readonly options: App_Options) {
    super('app', base.invocations)
    this.events = eventsOf(base.bus, { registered: App_Registered, updated: App_Updated, archived: App_Archived, restored: App_Restored, deleted: App_Deleted })
  }

  @UseCase()
  async register(input: unknown): Promise<AppDTO> {
    const fields = AppRegisterSchema.parse(input)
    if (await this.repo.isNameTaken(fields.name)) throw new AppNameTaken(fields.name)
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

  /** Changes its name, its address or its key: what is given and differs. */
  @UseCase()
  async update(id: string, input: unknown): Promise<AppDTO> {
    const change = AppUpdateSchema.parse(input)
    const app = await this.load(id)
    if (change.name !== undefined && await this.repo.isNameTaken(change.name, id)) throw new AppNameTaken(change.name)
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
   * Where an application is, and its key, opened: for the module that signs its
   * requests (`connection`). No route answers it.
   */
  @UseCase()
  async endpointOf(id: string): Promise<Endpoint> {
    const app = await this.load(id)
    return { url: app.url, key: app.key(this.options.cipher) }
  }

  private load(id: string): Promise<App> {
    return this.resolve(() => this.repo.find({ id }), () => new AppNotFound(id))
  }
}
