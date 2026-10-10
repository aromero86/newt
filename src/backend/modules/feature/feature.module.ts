import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { FeatureNameTaken } from './errors/feature-name-taken'
import { FeatureNotFound } from './errors/feature-not-found'
import {
  Feature,
  FeatureCreateSchema,
  FeatureMoveSchema,
  FeatureUpdateSchema,
  type FeatureCreateDTO,
  type FeatureDTO,
  type FeatureMoveDTO,
  type FeatureUpdateDTO,
} from './feature'
import type { Feature_Deps } from './feature.deps'
import { Feature_Repository } from './feature.repository'
import { registerFeatureRoutes } from './feature.routes'

const END = Number.MAX_SAFE_INTEGER

/**
 * The features of each workspace, each in one area. Any member edits them, until
 * the workspace is archived. Every feature that comes into an area or leaves it is
 * told to the area, in the same transaction.
 */
export class Feature_Module extends Module {

  static async initialize(base: Base, deps: Feature_Deps) {
    const module = new Feature_Module(base, new Feature_Repository(base), deps)
    registerFeatureRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Feature_Repository, private readonly deps: Feature_Deps) {
    super('feature', base.transactions)
  }

  /** A page of an area's active features in their order, or of its retired ones. */
  @UseCase('feature.list')
  async list(workspaceId: string, areaId: string, retired: boolean, page: PageRequest): Promise<Page<FeatureDTO>> {
    await this.deps.featureArea.get(workspaceId, areaId)
    const features = await this.repo.page(areaId, retired, page)
    return { ...features, items: features.items.map(feature => feature.toDTO()) }
  }

  @UseCase('feature.get')
  async get(workspaceId: string, featureId: string): Promise<FeatureDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return (await this.load(workspaceId, featureId)).toDTO()
  }

  /** At the end of its area. */
  @UseCase('feature.create')
  async create(workspaceId: string, input: FeatureCreateDTO): Promise<FeatureDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { areaId, name, description } = FeatureCreateSchema.parse(input)
    await this.deps.featureArea.assertActive(workspaceId, areaId)
    await this.assertNameFree(areaId, name)

    const position = await this.repo.count({ areaId, retired: false })
    const feature = Feature.create({ workspaceId, areaId, name, description, position })
    await this.repo.persist(feature)
    await this.deps.featureArea.featureAdded(areaId)
    return feature.toDTO()
  }

  @UseCase('feature.update')
  async update(workspaceId: string, featureId: string, input: FeatureUpdateDTO): Promise<FeatureDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const changes = FeatureUpdateSchema.parse(input)
    const feature = await this.load(workspaceId, featureId)
    if (changes.name !== undefined) await this.assertNameFree(feature.areaId, changes.name, featureId)

    feature.update(changes)
    await this.repo.persist(feature)
    return feature.toDTO()
  }

  /** To another area, to another place in its own, or both; the rest make room. */
  @UseCase('feature.move')
  async move(workspaceId: string, featureId: string, input: FeatureMoveDTO): Promise<FeatureDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { areaId = undefined, position = END } = FeatureMoveSchema.parse(input)
    const feature = await this.load(workspaceId, featureId)
    feature.assertActive()

    const from = { areaId: feature.areaId, position: feature.position! }
    const target = areaId ?? from.areaId

    if (target === from.areaId) {
      const to = Math.min(position, (await this.repo.count({ areaId: target, retired: false })) - 1)
      if (to < from.position) await this.shift(target, to, from.position - 1, 1)
      else await this.shift(target, from.position + 1, to, -1)
      feature.moveTo(target, to)
      await this.repo.persist(feature)
      return feature.toDTO()
    }

    await this.deps.featureArea.assertActive(workspaceId, target)
    await this.assertNameFree(target, feature.toDTO().name)
    const to = Math.min(position, await this.repo.count({ areaId: target, retired: false }))

    await this.shift(from.areaId, from.position + 1, END, -1)
    await this.shift(target, to, END, 1)
    feature.moveTo(target, to)
    await this.repo.persist(feature)
    await this.deps.featureArea.featureRemoved(from.areaId)
    await this.deps.featureArea.featureAdded(target)
    return feature.toDTO()
  }

  /** It no longer is in the product, but what it was can still be read. */
  @UseCase('feature.retire')
  async retire(workspaceId: string, featureId: string): Promise<FeatureDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const feature = await this.load(workspaceId, featureId)
    if (feature.isRetired) return feature.toDTO()

    const from = feature.position!
    feature.retire()
    await this.repo.persist(feature)
    await this.shift(feature.areaId, from + 1, END, -1)
    await this.deps.featureArea.featureRemoved(feature.areaId)
    return feature.toDTO()
  }

  /** Back at the end of its area, which must be active. */
  @UseCase('feature.restore')
  async restore(workspaceId: string, featureId: string): Promise<FeatureDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const feature = await this.load(workspaceId, featureId)
    if (!feature.isRetired) return feature.toDTO()

    await this.deps.featureArea.assertActive(workspaceId, feature.areaId)
    feature.restore(await this.repo.count({ areaId: feature.areaId, retired: false }))
    await this.repo.persist(feature)
    await this.deps.featureArea.featureAdded(feature.areaId)
    return feature.toDTO()
  }

  /** For the rule module: an active feature of this workspace, where rules can go. */
  @UseCase('feature.assertActive')
  async assertActive(workspaceId: string, featureId: string): Promise<FeatureDTO> {
    const feature = await this.load(workspaceId, featureId)
    feature.assertActive()
    return feature.toDTO()
  }

  /** For other modules that already checked who may see them. */
  @UseCase('feature.find')
  async find(workspaceId: string, ids: string[]): Promise<FeatureDTO[]> {
    return ids.length ? (await this.repo.find({ workspaceId, id: ids })).map(feature => feature.toDTO()) : []
  }

  /** An area's active features between two positions, both included, move `by` places. */
  private async shift(areaId: string, from: number, to: number, by: 1 | -1): Promise<void> {
    if (from > to) return
    for (const feature of await this.repo.find({ areaId, retired: false, positions: { from, to } })) {
      feature.moveTo(areaId, feature.position! + by)
      await this.repo.persist(feature)
    }
  }

  private load(workspaceId: string, featureId: string): Promise<Feature> {
    return this.resolve(() => this.repo.find({ workspaceId, id: [featureId] }), () => new FeatureNotFound(featureId))
  }

  /** Unique in its area, retired features too. */
  private async assertNameFree(areaId: string, name: string, exceptId?: string): Promise<void> {
    const [taken] = (await this.repo.find({ areaId, name })).filter(feature => feature.id !== exceptId)
    if (taken) throw new FeatureNameTaken(name.trim(), taken.isRetired)
  }
}
