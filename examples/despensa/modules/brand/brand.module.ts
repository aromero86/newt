import { eventsOf, Module, UseCase, type Ref } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { BrandNotFound } from './errors/brand-not-found'
import { Brand_Created } from './events/brand-created'
import { Brand_Deleted } from './events/brand-deleted'
import { Brand, BrandCreateSchema, type BrandCreateDTO, type BrandDTO } from './brand'
import { Brand_Repository } from './brand.repository'
import { registerBrandRoutes } from './brand.routes'

/** The makers products are sold under. */
export class Brand_Module extends Module {

  static initialize(base: ShopBase): Brand_Module {
    const module = new Brand_Module(base, new Brand_Repository(base))
    registerBrandRoutes(base, module)
    return module
  }

  readonly events

  private constructor(base: ShopBase, private readonly repo: Brand_Repository) {
    super('brand', base.invocations)
    this.events = eventsOf(base.bus, { created: Brand_Created, deleted: Brand_Deleted })
  }

  /** For other modules: the ones with these ids, as references (an id and a name); an id of none is not there. */
  @UseCase()
  async find(criteria: { id: string[] }): Promise<Ref[]> {
    if (criteria.id.length === 0) return []
    return (await this.repo.find({ id: { in: criteria.id } })).map(each => {
      const { id, name } = each.toDTO()
      return { id, name }
    })
  }

  /** For other modules: that it exists, or a `BrandNotFound`. */
  @UseCase()
  async assertExists(id: string): Promise<void> {
    await this.load(id)
  }

  @UseCase()
  async create(input: BrandCreateDTO): Promise<BrandDTO> {
    const { name } = BrandCreateSchema.parse(input)
    const brand = Brand.create(name)
    await this.repo.persist(brand)
    return brand.toDTO()
  }

  /** The products that had it are left without one, a moment later. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const brand = await this.load(id)
    brand.delete()
    await this.repo.persist(brand)
  }

  private load(id: string): Promise<Brand> {
    return this.resolve(() => this.repo.find({ id }), () => new BrandNotFound(id))
  }
}
