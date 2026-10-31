import { eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { MonitorBase } from '../../../../monitor-base'
import type { InstanceStartedDTO } from '../instances/instances.schema'
import { Deployment, type DeploymentDTO } from './deployment'
import type { Deployment_Deps } from './deployment.deps'
import { Deployment_Repository } from './deployment.repository'
import { registerDeploymentRoutes } from './deployment.routes'
import { registerDeploymentWorkers } from './deployment.workers'
import { Deployment_Recorded } from './events/deployment-recorded'

/** How many of an application's last deployments without a title are described again when it says where its code is. */
const DESCRIBED_AGAIN = 50

/**
 * Each commit an application deployed, as its instances tell it: when its first one
 * started, and its message, from the application's repository on GitHub.
 */
export class Deployment_Module extends Module {

  static initialize(base: MonitorBase, deps: Deployment_Deps): Deployment_Module {
    const module = new Deployment_Module(base, new Deployment_Repository(base), deps)
    registerDeploymentRoutes(base, module)
    registerDeploymentWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(base: MonitorBase, private readonly repo: Deployment_Repository, private readonly deps: Deployment_Deps) {
    super('deployment', base.invocations, deps)
    this.events = eventsOf(base.bus, { recorded: Deployment_Recorded })
  }

  /**
   * An instance heard of for the first time: a new deployment if its commit is new to
   * its application, else the one there, moved back if it started earlier. Nothing for
   * one with no commit, or of an application deleted since.
   */
  @UseCase()
  async record(started: InstanceStartedDTO): Promise<void> {
    if (started.commit === null || !await this.deps.app.find(started.appId)) return
    const known = await this.repo.first({ appId: started.appId, commit: started.commit })
    if (known) known.startedAgain(started.startedAt)
    await this.repo.persistOnce(known ?? Deployment.record(started.appId, started.commit, started.startedAt))
  }

  /** Asks its repository for a deployment's message, once its application says where it is: nothing to do once it has one. */
  @UseCase()
  async describe(id: string): Promise<void> {
    const deployment = await this.repo.first({ id })
    if (!deployment || deployment.title !== null) return
    const app = await this.deps.app.find(deployment.appId)
    if (!app?.repository) return
    const message = await this.deps.messages.message(app.repository, deployment.commit)
    if (message === null) return
    deployment.described(message)
    await this.repo.persist(deployment)
  }

  /** Describes an application's last deployments still without a title: its repository is new, or another. */
  @UseCase()
  async describeAll(appId: string): Promise<void> {
    const untitled = await this.repo.find({ appId, title: null }, { orderBy: [{ field: 'id', direction: 'desc' }], limit: DESCRIBED_AGAIN })
    for (const deployment of untitled) await this.describe(deployment.id)
  }

  /** A page of an application's deployments, the newest first. */
  @UseCase()
  async list(appId: string, page: PageRequest): Promise<Page<DeploymentDTO>> {
    await this.deps.app.get(appId)
    return mapPage(await this.repo.page({ appId }, page, { newestFirst: true }), deployment => deployment.toDTO())
  }

  /** Forgets everything of an application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }
}
