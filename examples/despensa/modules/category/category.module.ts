import { eventsOf, Module, UseCase, type Ref } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { CategoryNotFound } from './errors/category-not-found'
import { Category_Created } from './events/category-created'
import { Category_Deleted } from './events/category-deleted'
import { Category, CategoryCreateSchema, type CategoryCreateDTO, type CategoryDTO } from './category'
import { Category_Repository } from './category.repository'
import { registerCategoryRoutes } from './category.routes'

/** The families products are grouped in. */
export class Category_Module extends Module {

  static initialize(base: ShopBase): Category_Module {
    const module = new Category_Module(base, new Category_Repository(base))
    registerCategoryRoutes(base, module)
    return module
  }

  readonly events

  private constructor(base: ShopBase, private readonly repo: Category_Repository) {
    super('category', base.invocations)
    this.events = eventsOf(base.bus, { created: Category_Created, deleted: Category_Deleted })
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

  /** For other modules: that it exists, or a `CategoryNotFound`. */
  @UseCase()
  async assertExists(id: string): Promise<void> {
    await this.load(id)
  }

  @UseCase()
  async create(input: CategoryCreateDTO): Promise<CategoryDTO> {
    const { name } = CategoryCreateSchema.parse(input)
    const category = Category.create(name)
    await this.repo.persist(category)
    return category.toDTO()
  }

  /** The products that had it are left without one, a moment later. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const category = await this.load(id)
    category.delete()
    await this.repo.persist(category)
  }

  private load(id: string): Promise<Category> {
    return this.resolve(() => this.repo.find({ id }), () => new CategoryNotFound(id))
  }
}
