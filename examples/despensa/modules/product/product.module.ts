import {
  Product,
  ProductCreateSchema,
  ProductFilter,
  ProductFiltersSchema,
  ProductUpdateSchema,
  type ProductCreateDTO,
  type ProductDTO,
  type ProductFiltersDTO,
  type ProductUpdateDTO,
} from './product'
import { eventsOf, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { ProductNameTaken } from './errors/product-name-taken'
import { ProductNotFound } from './errors/product-not-found'
import { Product_Created } from './events/product-created'
import { Product_Updated } from './events/product-updated'
import type { Product_Deps } from './product.deps'
import { Product_Repository, type ProductRow } from './product.repository'
import { registerProductRoutes } from './product.routes'
import { registerProductWorkers } from './product.workers'

/** The catalog: what the shop sells, at what price, of which brand and category. */
export class Product_Module extends Module {

  static initialize(base: ShopBase, deps: Product_Deps): Product_Module {
    const module = new Product_Module(base, new Product_Repository(base), deps)
    registerProductRoutes(base, module)
    registerProductWorkers(module, deps)
    return module
  }

  readonly events

  private constructor(base: ShopBase, private readonly repo: Product_Repository, private readonly deps: Product_Deps) {
    super('product', base.invocations)
    this.events = eventsOf(base.bus, { created: Product_Created, updated: Product_Updated })
  }

  @UseCase()
  async list(filters: ProductFiltersDTO, page: PageRequest): Promise<Page<ProductDTO>> {
    const found = await this.repo.page(ProductFiltersSchema.parse(filters), page)
    return {
      items: found.items.map(product => product.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  /** The products the filter asks for: only the fields and operators `ProductFilter` allows. */
  @UseCase()
  async search(filter: unknown, page: PageRequest): Promise<Page<ProductDTO>> {
    const criteria = ProductFilter.toCriteria<ProductRow>(ProductFilter.schema.parse(filter))
    const found = await this.repo.page({ and: [criteria, { archived: false }] }, page)
    return {
      items: found.items.map(product => product.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  @UseCase()
  async get(id: string): Promise<ProductDTO> {
    return (await this.load(id)).toDTO()
  }

  /** For other modules: the ones with these ids, in no order; an id of none is not there. */
  @UseCase()
  async findByIds(ids: string[]): Promise<ProductDTO[]> {
    if (ids.length === 0) return []
    return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(each => each.toDTO())
  }

  /** For other modules: that it exists, or a `ProductNotFound`. */
  @UseCase()
  async assertExists(id: string): Promise<void> {
    await this.load(id)
  }

  @UseCase()
  async create(input: ProductCreateDTO): Promise<ProductDTO> {
    const { name, priceCents, brandId, categoryId } = ProductCreateSchema.parse(input)
    await this.assertNameFree(name)
    await this.assertReferences({ brandId, categoryId })
    const product = Product.create({ name, priceCents, brandId, categoryId })
    await this.repo.persist(product)
    return product.toDTO()
  }

  @UseCase()
  async update(id: string, input: ProductUpdateDTO): Promise<ProductDTO> {
    const changes = ProductUpdateSchema.parse(input)
    const product = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(changes.name, id)
    await this.assertReferences(changes)
    product.update(changes)
    await this.repo.persist(product)
    return product.toDTO()
  }

  /** A brand was deleted: its products are left without one. What a worker calls; safe to run again. */
  @UseCase()
  async forgetBrand(brandId: string): Promise<void> {
    const products = await this.repo.find({ brandId })
    for (const product of products) product.update({ brandId: null })
    await this.repo.persist(...products)
  }

  /** A category was deleted: its products are left without one. What a worker calls; safe to run again. */
  @UseCase()
  async forgetCategory(categoryId: string): Promise<void> {
    const products = await this.repo.find({ categoryId })
    for (const product of products) product.update({ categoryId: null })
    await this.repo.persist(...products)
  }

  private load(id: string): Promise<Product> {
    return this.resolve(() => this.repo.find({ id }), () => new ProductNotFound(id))
  }

  /** A clear answer in the usual case; the table's unique name settles two at once. */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new ProductNameTaken(name)
  }

  /**
   * The brand and category it points at exist: asked to their modules (a read), never
   * to their tables. One that does not is a `ReferenceNotFound` (400: the request is
   * wrong); `null` is "none", and one not given is not looked at.
   */
  private async assertReferences(references: { brandId?: string | null, categoryId?: string | null }): Promise<void> {
    await this.resolveRefs(
      { brandId: references.brandId, categoryId: references.categoryId },
      { brandId: this.deps.brand, categoryId: this.deps.category },
    )
  }
}
