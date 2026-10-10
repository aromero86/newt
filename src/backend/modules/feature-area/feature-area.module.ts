import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { FeatureAreaNameTaken } from './errors/feature-area-name-taken'
import { FeatureAreaNotFound } from './errors/feature-area-not-found'
import {
  FeatureArea,
  FeatureAreaCreateSchema,
  FeatureAreaMoveSchema,
  FeatureAreaUpdateSchema,
  type FeatureAreaCreateDTO,
  type FeatureAreaDTO,
  type FeatureAreaMoveDTO,
  type FeatureAreaUpdateDTO,
} from './feature-area'
import type { FeatureArea_Deps } from './feature-area.deps'
import { FeatureArea_Repository } from './feature-area.repository'
import { registerFeatureAreaRoutes } from './feature-area.routes'

const END = Number.MAX_SAFE_INTEGER

/**
 * The areas each workspace groups its features in. Any member edits them, until the
 * workspace is archived. How many active features each has is kept by the feature
 * module, which calls in when a feature comes or goes.
 */
export class FeatureArea_Module extends Module {

  static async initialize(base: Base, deps: FeatureArea_Deps) {
    const module = new FeatureArea_Module(base, new FeatureArea_Repository(base), deps)
    registerFeatureAreaRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: FeatureArea_Repository, private readonly deps: FeatureArea_Deps) {
    super('feature-area', base.transactions)
  }

  /** A page of the workspace's active areas in their order, or of its retired ones. */
  @UseCase('featureArea.list')
  async list(workspaceId: string, retired: boolean, page: PageRequest): Promise<Page<FeatureAreaDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const areas = await this.repo.page(workspaceId, retired, page)
    return { ...areas, items: areas.items.map(area => area.toDTO()) }
  }

  @UseCase('featureArea.get')
  async get(workspaceId: string, areaId: string): Promise<FeatureAreaDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return (await this.load(workspaceId, areaId)).toDTO()
  }

  /** At the end of the order. */
  @UseCase('featureArea.create')
  async create(workspaceId: string, input: FeatureAreaCreateDTO): Promise<FeatureAreaDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { name, description } = FeatureAreaCreateSchema.parse(input)
    await this.assertNameFree(workspaceId, name)

    const position = await this.repo.count({ workspaceId, retired: false })
    const area = FeatureArea.create({ workspaceId, name, description, position })
    await this.repo.persist(area)
    return area.toDTO()
  }

  @UseCase('featureArea.update')
  async update(workspaceId: string, areaId: string, input: FeatureAreaUpdateDTO): Promise<FeatureAreaDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const changes = FeatureAreaUpdateSchema.parse(input)
    const area = await this.load(workspaceId, areaId)
    if (changes.name !== undefined) await this.assertNameFree(workspaceId, changes.name, areaId)

    area.update(changes)
    await this.repo.persist(area)
    return area.toDTO()
  }

  /** To another place among the active areas; the ones in between make room. */
  @UseCase('featureArea.move')
  async move(workspaceId: string, areaId: string, input: FeatureAreaMoveDTO): Promise<FeatureAreaDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { position } = FeatureAreaMoveSchema.parse(input)
    const area = await this.load(workspaceId, areaId)
    area.assertActive()

    const from = area.position!
    const to = Math.min(position, (await this.repo.count({ workspaceId, retired: false })) - 1)
    if (to < from) await this.shift(workspaceId, to, from - 1, 1)
    else await this.shift(workspaceId, from + 1, to, -1)

    area.moveTo(to)
    await this.repo.persist(area)
    return area.toDTO()
  }

  /** Only an area without active features: they are retired or moved first. */
  @UseCase('featureArea.retire')
  async retire(workspaceId: string, areaId: string): Promise<FeatureAreaDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const area = await this.load(workspaceId, areaId)
    const from = area.position

    area.retire()
    await this.repo.persist(area)
    if (from !== null) await this.shift(workspaceId, from + 1, END, -1)
    return area.toDTO()
  }

  /** Back at the end of the order. */
  @UseCase('featureArea.restore')
  async restore(workspaceId: string, areaId: string): Promise<FeatureAreaDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const area = await this.load(workspaceId, areaId)
    area.restore(await this.repo.count({ workspaceId, retired: false }))
    await this.repo.persist(area)
    return area.toDTO()
  }

  /** For the feature module: an active area of this workspace, where features can go. */
  @UseCase('featureArea.assertActive')
  async assertActive(workspaceId: string, areaId: string): Promise<FeatureAreaDTO> {
    const area = await this.load(workspaceId, areaId)
    area.assertActive()
    return area.toDTO()
  }

  /** For the feature module: one more active feature in the area. */
  @UseCase('featureArea.featureAdded')
  async featureAdded(areaId: string): Promise<void> {
    const area = await this.resolve(() => this.repo.find({ id: [areaId] }), () => new FeatureAreaNotFound(areaId))
    area.featureAdded()
    await this.repo.persist(area)
  }

  /** For the feature module: one active feature fewer in the area. */
  @UseCase('featureArea.featureRemoved')
  async featureRemoved(areaId: string): Promise<void> {
    const area = await this.resolve(() => this.repo.find({ id: [areaId] }), () => new FeatureAreaNotFound(areaId))
    area.featureRemoved()
    await this.repo.persist(area)
  }

  /** The active areas between two positions, both included, move `by` places. */
  private async shift(workspaceId: string, from: number, to: number, by: 1 | -1): Promise<void> {
    if (from > to) return
    for (const area of await this.repo.find({ workspaceId, retired: false, positions: { from, to } })) {
      area.moveTo(area.position! + by)
      await this.repo.persist(area)
    }
  }

  private load(workspaceId: string, areaId: string): Promise<FeatureArea> {
    return this.resolve(() => this.repo.find({ workspaceId, id: [areaId] }), () => new FeatureAreaNotFound(areaId))
  }

  /** Unique in the workspace, retired areas too. */
  private async assertNameFree(workspaceId: string, name: string, exceptId?: string): Promise<void> {
    const [taken] = (await this.repo.find({ workspaceId, name })).filter(area => area.id !== exceptId)
    if (taken) throw new FeatureAreaNameTaken(name.trim(), taken.isRetired)
  }
}
