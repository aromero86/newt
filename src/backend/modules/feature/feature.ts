import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { FeatureRetired } from './errors/feature-retired'
import { FeatureSchema, type FeatureDTO } from './feature.schema'

export * from './feature.schema'

/** Something that can be done in the product, in one area. Retired, never removed. */
export class Feature extends Entity<typeof FeatureSchema> {

  private constructor(input: EntityInput<FeatureDTO>, isNew: boolean) {
    super(FeatureSchema, input, isNew)
  }

  static fromDTO(dto: FeatureDTO): Feature {
    return new Feature(dto, false)
  }

  static create(input: { workspaceId: string, areaId: string, name: string, description: string, position: number }): Feature {
    return new Feature({ ...input, retiredAt: null }, true)
  }

  get areaId(): string {
    return this.data.areaId
  }

  get position(): number | null {
    return this.data.position
  }

  get isRetired(): boolean {
    return this.data.retiredAt !== null
  }

  update(changes: Partial<Pick<FeatureDTO, 'name' | 'description'>>): void {
    this.assertActive()
    this.change(changes)
  }

  moveTo(areaId: string, position: number): void {
    this.assertActive()
    this.change({ areaId, position })
  }

  /** It leaves the order of its area. */
  retire(): void {
    if (!this.isRetired) this.change({ retiredAt: new Date().toISOString(), position: null })
  }

  /** Back at the end of its area. */
  restore(position: number): void {
    if (this.isRetired) this.change({ retiredAt: null, position })
  }

  assertActive(): void {
    if (this.isRetired) throw new FeatureRetired()
  }
}
