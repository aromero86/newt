import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import {
  Dimension,
  DimensionLimits,
  DimensionNameInputSchema,
  DimensionOrderSchema,
  type DimensionDTO,
  type DimensionNameInputDTO,
  type DimensionOrderDTO,
} from './dimension'
import type { Dimension_Deps } from './dimension.deps'
import { Dimension_Repository } from './dimension.repository'
import { registerDimensionRoutes } from './dimension.routes'
import { DimensionLimitReached } from './errors/dimension-limit-reached'
import { DimensionNameTaken } from './errors/dimension-name-taken'
import { DimensionNotFound } from './errors/dimension-not-found'
import { InvalidOrder } from './errors/invalid-order'

/**
 * Each workspace's dimensions: the axes that say where each part of its product
 * applies, with their values. Any member edits them, until the workspace is archived.
 */
export class Dimension_Module extends Module {

  static async initialize(base: Base, deps: Dimension_Deps) {
    const module = new Dimension_Module(base, new Dimension_Repository(base), deps)
    registerDimensionRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Dimension_Repository, private readonly deps: Dimension_Deps) {
    super('dimension', base.transactions)
  }

  /** The workspace's dimensions, in order, with all their values. Bounded by design. */
  @UseCase('dimension.list')
  async list(workspaceId: string): Promise<DimensionDTO[]> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return (await this.repo.find({ workspaceId })).map(dimension => dimension.toContract())
  }

  @UseCase('dimension.create')
  async create(workspaceId: string, input: DimensionNameInputDTO): Promise<DimensionDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { name } = DimensionNameInputSchema.parse(input)

    const count = await this.repo.count(workspaceId)
    if (count >= DimensionLimits.dimensions) throw new DimensionLimitReached('dimensions', DimensionLimits.dimensions)
    await this.assertNameFree(workspaceId, name)

    const dimension = Dimension.create(workspaceId, name, count)
    await this.repo.persist(dimension)
    return dimension.toContract()
  }

  @UseCase('dimension.rename')
  async rename(workspaceId: string, dimensionId: string, input: DimensionNameInputDTO): Promise<DimensionDTO> {
    return this.edit(workspaceId, dimensionId, async dimension => {
      const { name } = DimensionNameInputSchema.parse(input)
      await this.assertNameFree(workspaceId, name, dimensionId)
      dimension.rename(name)
    })
  }

  /** `order` lists every dimension of the workspace once, in the new order. */
  @UseCase('dimension.reorder')
  async reorder(workspaceId: string, input: DimensionOrderDTO): Promise<DimensionDTO[]> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { order } = DimensionOrderSchema.parse(input)

    const dimensions = await this.repo.find({ workspaceId })
    const byId = new Map(dimensions.map(dimension => [dimension.id, dimension]))
    if (order.length !== dimensions.length || new Set(order).size !== order.length || !order.every(id => byId.has(id))) throw new InvalidOrder()

    for (const [position, id] of order.entries()) {
      const dimension = byId.get(id)!
      dimension.moveTo(position)
      await this.repo.persist(dimension)
    }
    return order.map(id => byId.get(id)!.toContract())
  }

  @UseCase('dimension.addValue')
  async addValue(workspaceId: string, dimensionId: string, input: DimensionNameInputDTO): Promise<DimensionDTO> {
    return this.edit(workspaceId, dimensionId, async dimension => {
      dimension.addValue(DimensionNameInputSchema.parse(input).name)
    })
  }

  /** The value keeps its id: whatever uses it keeps meaning the same thing. */
  @UseCase('dimension.renameValue')
  async renameValue(workspaceId: string, dimensionId: string, valueId: string, input: DimensionNameInputDTO): Promise<DimensionDTO> {
    return this.edit(workspaceId, dimensionId, async dimension => {
      dimension.renameValue(valueId, DimensionNameInputSchema.parse(input).name)
    })
  }

  @UseCase('dimension.reorderValues')
  async reorderValues(workspaceId: string, dimensionId: string, input: DimensionOrderDTO): Promise<DimensionDTO> {
    return this.edit(workspaceId, dimensionId, async dimension => {
      dimension.reorderValues(DimensionOrderSchema.parse(input).order)
    })
  }

  @UseCase('dimension.retireValue')
  async retireValue(workspaceId: string, dimensionId: string, valueId: string): Promise<DimensionDTO> {
    return this.edit(workspaceId, dimensionId, async dimension => dimension.retireValue(valueId))
  }

  @UseCase('dimension.restoreValue')
  async restoreValue(workspaceId: string, dimensionId: string, valueId: string): Promise<DimensionDTO> {
    return this.edit(workspaceId, dimensionId, async dimension => dimension.restoreValue(valueId))
  }

  /** Loads one dimension of a writable workspace, applies `change` and saves it. */
  private async edit(workspaceId: string, dimensionId: string, change: (dimension: Dimension) => Promise<void>): Promise<DimensionDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const [dimension] = await this.repo.find({ workspaceId, id: [dimensionId] })
    if (!dimension) throw new DimensionNotFound(dimensionId)

    await change(dimension)
    await this.repo.persist(dimension)
    return dimension.toContract()
  }

  private async assertNameFree(workspaceId: string, name: string, exceptId?: string): Promise<void> {
    const dimensions = await this.repo.find({ workspaceId })
    const taken = dimensions.find(dimension => dimension.id !== exceptId && dimension.name.trim().toLowerCase() === name.trim().toLowerCase())
    if (taken) throw new DimensionNameTaken(name.trim())
  }
}
