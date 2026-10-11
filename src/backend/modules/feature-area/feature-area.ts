import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { FeatureAreaRetired } from './errors/feature-area-retired'
import { FeatureAreaHasFeatures } from './errors/feature-area-has-features'
import { FeatureAreaSchema, type FeatureAreaDTO } from './feature-area.schema'

export * from './feature-area.schema'

/**
 * A group of features: a part of the product, such as Checkout or Account. Where
 * something applies is not said here: that is what dimensions are for.
 */
export class FeatureArea extends Entity<typeof FeatureAreaSchema> {

  private constructor(input: EntityInput<FeatureAreaDTO>, isNew: boolean) {
    super(FeatureAreaSchema, input, isNew)
  }

  static fromDTO(dto: FeatureAreaDTO): FeatureArea {
    return new FeatureArea(dto, false)
  }

  static create(input: { id?: string, workspaceId: string, name: string, description: string, position: number }): FeatureArea {
    return new FeatureArea({ ...input, activeFeatures: 0, retiredAt: null }, true)
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get name(): string {
    return this.data.name
  }

  get position(): number | null {
    return this.data.position
  }

  get isRetired(): boolean {
    return this.data.retiredAt !== null
  }

  update(changes: Partial<Pick<FeatureAreaDTO, 'name' | 'description'>>): void {
    this.assertActive()
    this.change(changes)
  }

  moveTo(position: number): void {
    this.assertActive()
    this.change({ position })
  }

  /** Only once it has no active features left. It leaves the order. */
  retire(): void {
    if (this.isRetired) return
    if (this.data.activeFeatures > 0) throw new FeatureAreaHasFeatures(this.data.activeFeatures)
    this.change({ retiredAt: new Date().toISOString(), position: null })
  }

  /** Back at the end of the order. */
  restore(position: number): void {
    if (this.isRetired) this.change({ retiredAt: null, position })
  }

  featureAdded(): void {
    this.assertActive()
    this.change({ activeFeatures: this.data.activeFeatures + 1 })
  }

  featureRemoved(): void {
    this.change({ activeFeatures: Math.max(0, this.data.activeFeatures - 1) })
  }

  assertActive(): void {
    if (this.isRetired) throw new FeatureAreaRetired()
  }
}
