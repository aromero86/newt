import { computed } from '@preact/signals-core'
import { ApiError, inject, Store } from 'newt-kit-react'
import { toast } from 'newt-kit-react-ui/toast'
import { AppApi, type AppDTO } from '../../api/app'
import { CatalogApi, type CatalogItemDTO } from '../../api/catalog'
import { ConnectionApi, type ConnectionStatusDTO } from '../../api/connection'
import { DeploymentApi, type DeploymentDTO } from '../../api/deployment'
import { InstancesApi, type InstanceDTO, type InstancesDTO } from '../../api/instances'
import { StructureApi, type StructureVersionDTO } from '../../api/structure'

/** A moment the charts mark: a commit deployed (or, before any is known, a new version of its structure), an instance that started, stopped or was lost. */
export type AppMark = { at: string, label: string, detail?: string | null, tone: 'brand' | 'ok' | 'warn' | 'bad' | 'muted', instance?: boolean }

/** A commit's first characters, as GitHub shows it. */
export const shortCommit = (commit: string) => commit.slice(0, 7)

/** Where a commit is on its repository: none while the application does not say where its code is. */
export const commitUrl = (repository: string | null, commit: string) => (repository ? `${repository}/commit/${commit}` : null)

/** The moments it deployed each commit. */
function deploymentMarks(deployments: DeploymentDTO[]): AppMark[] {
  return deployments.map(deployment => ({ at: deployment.deployedAt, label: `Deployed ${shortCommit(deployment.commit)}${deployment.title ? `: ${deployment.title}` : ''}`, detail: deployment.description, tone: 'brand' }))
}

/** The moments its instances started, stopped or were lost. */
function instanceMarks(instances: InstanceDTO[]): AppMark[] {
  return instances.flatMap(instance => {
    const name = instance.instanceId.slice(0, 8)
    const marks: AppMark[] = [{ at: instance.startedAt, label: `Started: ${name}`, tone: 'ok', instance: true }]
    if (instance.status === 'stopped') marks.push({ at: instance.stoppedAt ?? instance.lastSeenAt, label: `Stopped: ${name}`, tone: 'muted', instance: true })
    if (instance.status === 'lost') marks.push({ at: instance.lastSeenAt, label: `Lost: ${name}`, tone: 'bad', instance: true })
    return marks
  })
}

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
  /** Its last deployments, the newest first: empty until asked for, or when none is known. */
  deployments: DeploymentDTO[]
  /** Its system and instances now; null until asked for, or when it could not be. */
  instances: InstancesDTO | null
  /** Why they could not be asked for; null when they were, or were not yet. */
  instancesFailure: string | null
  /** What its charts mark: its versions and its instances' comings and goings. */
  marks: AppMark[]
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
  private readonly instanceApi = inject(InstancesApi)
  private readonly deploymentApi = inject(DeploymentApi)
  private readonly store = new Store<AppState>({ appId: '', app: undefined, connection: null, structure: null, failure: null, checking: false, refreshing: false, removed: null, showRemoved: false, deployments: [], instances: null, instancesFailure: null, marks: [] })

  readonly app = this.store.select('app')
  readonly connection = this.store.select('connection')
  readonly structure = this.store.select('structure')
  readonly failure = this.store.select('failure')
  readonly checking = this.store.select('checking')
  readonly refreshing = this.store.select('refreshing')
  readonly removed = this.store.select('removed')
  readonly showRemoved = this.store.select('showRemoved')
  readonly deployments = this.store.select('deployments')
  readonly instances = this.store.select('instances')
  readonly instancesFailure = this.store.select('instancesFailure')
  readonly marks = this.store.select('marks')

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
    this.store.patch({ appId, app: undefined, connection: null, structure: null, failure: null, removed: null, deployments: [], instances: null, instancesFailure: null, marks: [] })
    void this.loadMarks(appId)
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

  /** Its system and instances now, asked again: and their comings and goings, marked. */
  async loadInstances(): Promise<void> {
    const appId = this.appId
    let instances: InstancesDTO | null = null
    let instancesFailure: string | null = null
    try {
      instances = await this.instanceApi.list(appId)
    } catch (error) {
      instancesFailure = error instanceof Error ? error.message : 'Could not load its instances'
    }
    if (this.appId !== appId) return
    const others = this.store.value.marks.filter(mark => !mark.instance)
    this.store.patch({ instances, instancesFailure, marks: [...others, ...instanceMarks(instances?.instances ?? [])] })
  }

  /**
   * Its last 100 deployments (or, while none is known, its structure's versions) and its
   * instances, as marks: without them, charts mark nothing.
   */
  private async loadMarks(appId: string): Promise<void> {
    let instancesFailure: string | null = null
    const [deployments, versions, instances] = await Promise.all([
      this.deploymentApi.list(appId, { size: 100 }).catch(() => null),
      this.structures.versions(appId, { size: 100 }).catch(() => null),
      this.instanceApi.list(appId).catch((error: unknown) => {
        instancesFailure = error instanceof Error ? error.message : 'Could not load its instances'
        return null
      }),
    ])
    // The first version is when the monitor first read it, no deployment.
    const changed: AppMark[] = (versions?.hasMore ? versions.items : (versions?.items ?? []).slice(0, -1)).map(version => ({ at: version.takenAt, label: 'Its structure changed: deployed', tone: 'brand' }))
    const known = deployments?.items ?? []
    const deployed = known.length > 0 ? deploymentMarks(known) : changed
    if (this.appId === appId) this.store.patch({ deployments: known, instances, instancesFailure, marks: [...deployed, ...instanceMarks(instances?.instances ?? [])] })
  }

  /** Its last version, or null while none was read. */
  private latest(appId: string): Promise<StructureVersionDTO | null> {
    return this.structures.latest(appId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === 'structure.not_read') return null
      throw error
    })
  }
}
