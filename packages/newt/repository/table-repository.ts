import { allOf, toPage, type Criteria, type Entity, type EntitySchema, type Page, type PageRequest } from '../core'
import type { FindOptions, NewRow, StoredRow, Table } from '../port-store'
import { Repository } from './repository'
import type { RepositoryBase } from './repository-base'
import type { TableRepositoryOptions } from './table-repository-options'

/**
 * A repository whose entities are the rows of one table, in any store: say how a row
 * becomes an entity, and finding, paging and saving come done.
 *
 * ```ts
 * class Brand_Repository extends TableRepository<Brand, BrandRow> {
 *   constructor(base: Base) {
 *     super(base, base.store.table('brand', { types: { archived: 'boolean' } }), { softDelete: true })
 *   }
 *   protected toEntity(row: BrandRow) {
 *     return Brand.fromDTO(row)
 *   }
 * }
 * ```
 *
 * A row is the entity's DTO with its version (and `deletedAt` when soft deleted); a
 * repository whose rows differ says how in `toRow` and `toChanges`. What a table
 * cannot ask, it asks its store's adapter directly.
 */
export abstract class TableRepository<
  E extends Entity<EntitySchema>,
  Row extends StoredRow,
  B extends RepositoryBase = RepositoryBase,
> extends Repository<E, B> {

  constructor(base: B, protected readonly table: Table<Row>, private readonly options: TableRepositoryOptions = {}) {
    super(base)
  }

  protected abstract toEntity(row: Row): E

  /** The row a new entity is stored as. */
  protected toRow(entity: E): NewRow<Row> {
    const row = entity.toDTO() as Record<string, unknown>
    return (this.options.softDelete ? { ...row, deletedAt: null } : row) as NewRow<Row>
  }

  /** What changed of a stored entity, as its row's fields. */
  protected toChanges(entity: E): Partial<NewRow<Row>> {
    return { ...entity.getChanges(), updatedAt: entity.toDTO().updatedAt } as unknown as Partial<NewRow<Row>>
  }

  /** The ones that meet the criteria, by id unless told otherwise. */
  async find(criteria: Criteria<Row> = {}, options?: FindOptions<Row>): Promise<E[]> {
    const rows = await this.table.find(this.visible(criteria), options)
    return rows.map(row => this.toEntity(row))
  }

  async first(criteria: Criteria<Row> = {}, options?: FindOptions<Row>): Promise<E | undefined> {
    const [entity] = await this.find(criteria, { ...options, limit: 1 })
    return entity
  }

  count(criteria: Criteria<Row> = {}): Promise<number> {
    return this.table.count(this.visible(criteria))
  }

  /** A page of the ones that meet the criteria, by id: ids are v7, so in the order they were created. */
  async page(criteria: Criteria<Row>, page: PageRequest): Promise<Page<E>> {
    const after = page.cursor ? allOf(criteria, { id: { gt: page.cursor } } as Criteria<Row>) : criteria
    const [entities, total] = await Promise.all([this.find(after, { limit: page.size + 1 }), this.count(criteria)])
    return toPage(entities, page.size, total)
  }

  /** Saves them, and what they have to tell, at once: all or none. */
  async persist(...entities: E[]): Promise<void> {
    await this.save(entities, entity => this.write(entity))
  }

  /** Stores one: inserted when new, changed when stored, deleted (or stamped) when deleted. */
  protected async write(entity: E): Promise<void> {
    if (entity.isNew) return this.table.insert(this.toRow(entity))
    if (entity.isDeleted) {
      if (!this.options.softDelete) return this.table.delete(entity.id, entity.version)
      const now = new Date().toISOString()
      return this.table.update(entity.id, entity.version, { deletedAt: now, updatedAt: now } as unknown as Partial<NewRow<Row>>)
    }
    return this.table.update(entity.id, entity.version, this.toChanges(entity))
  }

  private visible(criteria: Criteria<Row>): Criteria<Row> {
    return this.options.softDelete ? allOf(criteria, { deletedAt: null } as unknown as Criteria<Row>) : criteria
  }
}
