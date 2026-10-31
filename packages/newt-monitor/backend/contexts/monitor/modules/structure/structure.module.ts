import { eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import { StructureNotRead } from './errors/structure-not-read'
import { StructureVersionNotFound } from './errors/structure-version-not-found'
import { Structure_Changed } from './events/structure-changed'
import { hashOf, StructureVersion, type RefreshAllDTO, type RefreshDTO, type StructureVersionDTO, type StructureVersionSummaryDTO } from './structure'
import type { Structure_Deps } from './structure.deps'
import { StructureVersion_Repository } from './structure.repository'
import { registerStructureRoutes } from './structure.routes'
import { registerStructureWorkers } from './structure.workers'

/**
 * What each application is made of: read from it, and kept as a new version each time
 * it changes, so its history says when each part came and went.
 */
export class Structure_Module extends Module {

  static initialize(base: MonitorBase, deps: Structure_Deps): Structure_Module {
    const module = new Structure_Module(base, new StructureVersion_Repository(base), deps)
    registerStructureRoutes(base, module)
    registerStructureWorkers(module, deps)
    return module
  }

  readonly events
  /** Every hour, on the hour: every application watched is refreshed. */
  readonly hourly

  private constructor(base: MonitorBase, private readonly repo: StructureVersion_Repository, private readonly deps: Structure_Deps) {
    super('structure', base.invocations, deps)
    this.events = eventsOf(base.bus, { changed: Structure_Changed })
    this.hourly = base.schedules.define('structure.hourly', '0 * * * *')
  }

  /**
   * Reads the application's structure, and keeps it as a new version if it is not the
   * last one. One that does not answer keeps its last version, and says why.
   */
  // Asking the application records, in `connection`, whether it answered: a note of the
  // call, which every call makes, not a change of the connection this use case decides.
  @UseCase({ writesTo: ['connection'] })
  async refresh(appId: string): Promise<RefreshDTO> {
    const app = await this.deps.app.find(appId)
    if (!app) return { appId, outcome: 'gone', version: null }
    const previous = await this.repo.latest(appId)
    if (app.archivedAt !== null) return { appId, outcome: 'archived', version: previous?.summary() ?? null }
    const read = await this.deps.connection.fetchStructure(appId)
    if (!read.answered) return { appId, outcome: 'unreachable', version: previous?.summary() ?? null, failure: read.failure }

    const hash = hashOf(read.value)
    if (previous?.hash === hash) return { appId, outcome: 'unchanged', version: previous.summary() }
    const version = StructureVersion.take(appId, read.value, hash, previous)
    // Deleted while it was read: what it is made of is forgotten, and stays so.
    if (!await this.repo.persistAfter(version, previous, async () => await this.deps.app.find(appId) !== null)) return { appId, outcome: 'gone', version: null }
    return { appId, outcome: 'changed', version: version.summary() }
  }

  /**
   * Refreshes every application watched, one after another: one that does not answer
   * is recorded so, and the others go on.
   */
  @UseCase({ writesTo: ['connection'] })
  async refreshAll(): Promise<RefreshAllDTO> {
    const refreshed: RefreshDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) refreshed.push(await this.refresh(appId))
    return { refreshed }
  }

  /** Its last version, whole. */
  @UseCase()
  async latest(appId: string): Promise<StructureVersionDTO> {
    await this.deps.app.get(appId)
    const latest = await this.repo.latest(appId)
    if (!latest) throw new StructureNotRead(appId)
    return latest.toDTO()
  }

  /** A page of its versions, the newest first, without their descriptions. */
  @UseCase()
  async history(appId: string, page: PageRequest): Promise<Page<StructureVersionSummaryDTO>> {
    await this.deps.app.get(appId)
    return mapPage(await this.repo.page({ appId }, page, { newestFirst: true }), version => version.summary())
  }

  /** One of its versions, whole. */
  @UseCase()
  async get(appId: string, versionId: string): Promise<StructureVersionDTO> {
    const version = await this.resolve(() => this.repo.find({ id: versionId, appId }), () => new StructureVersionNotFound(versionId))
    return version.toDTO()
  }

  /** Forgets everything of an application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }
}
