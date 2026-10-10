import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { DimensionLimits, DimensionSchema, type DimensionDTO, type DimensionValueDTO } from './dimension.schema'
import { DimensionLimitReached } from './errors/dimension-limit-reached'
import { DimensionValueNameTaken } from './errors/dimension-value-name-taken'
import { DimensionValueNotFound } from './errors/dimension-value-not-found'
import { InvalidOrder } from './errors/invalid-order'

export * from './dimension.schema'

// The contract plus where the dimension sits among its workspace's.
const DimensionEntitySchema = DimensionSchema.extend({ position: z.number().int().min(0) })

type DimensionEntityDTO = z.infer<typeof DimensionEntitySchema>

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** A dimension and its values, in order. Values are retired, never removed. */
export class Dimension extends Entity<typeof DimensionEntitySchema> {

  private constructor(input: EntityInput<DimensionEntityDTO>, isNew: boolean) {
    super(DimensionEntitySchema, input, isNew)
  }

  static fromDTO(dto: DimensionEntityDTO): Dimension {
    return new Dimension(dto, false)
  }

  static create(workspaceId: string, name: string, position: number): Dimension {
    return new Dimension({ workspaceId, name: name.trim(), values: [], position }, true)
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get name(): string {
    return this.data.name
  }

  get position(): number {
    return this.data.position
  }

  /** The contract: everything but the position, which the order of the list says. */
  toContract(): DimensionDTO {
    const { position: _, ...contract } = this.toDTO()
    return contract
  }

  rename(name: string): void {
    this.change({ name: name.trim() })
  }

  moveTo(position: number): void {
    this.change({ position })
  }

  addValue(name: string): DimensionValueDTO {
    const values = this.data.values
    if (values.length >= DimensionLimits.values) throw new DimensionLimitReached('values', DimensionLimits.values)
    this.assertFree(name)
    const value = { id: Bun.randomUUIDv7(), name: name.trim(), retiredAt: null }
    this.change({ values: [...values, value] })
    return value
  }

  renameValue(valueId: string, name: string): void {
    this.value(valueId)
    this.assertFree(name, valueId)
    this.updateValue(valueId, { name: name.trim() })
  }

  retireValue(valueId: string): void {
    if (this.value(valueId).retiredAt === null) this.updateValue(valueId, { retiredAt: new Date().toISOString() })
  }

  restoreValue(valueId: string): void {
    this.value(valueId)
    this.updateValue(valueId, { retiredAt: null })
  }

  /** `order` lists every value id once, in the new order. */
  reorderValues(order: string[]): void {
    const values = this.data.values
    if (order.length !== values.length || new Set(order).size !== order.length) throw new InvalidOrder()
    const byId = new Map(values.map(value => [value.id, value]))
    if (!order.every(id => byId.has(id))) throw new InvalidOrder()
    this.change({ values: order.map(id => byId.get(id)!) })
  }

  private value(valueId: string): DimensionValueDTO {
    const value = this.data.values.find(candidate => candidate.id === valueId)
    if (!value) throw new DimensionValueNotFound(valueId)
    return value
  }

  private updateValue(valueId: string, changes: Partial<DimensionValueDTO>): void {
    this.change({ values: this.data.values.map(value => (value.id === valueId ? { ...value, ...changes } : value)) })
  }

  /** A name is unique among the values, retired ones too. */
  private assertFree(name: string, exceptId?: string): void {
    const taken = this.data.values.find(value => value.id !== exceptId && same(value.name, name))
    if (taken) throw new DimensionValueNameTaken(name.trim(), taken.retiredAt !== null)
  }
}
