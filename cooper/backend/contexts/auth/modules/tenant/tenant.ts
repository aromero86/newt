import { Entity, type EntityInput } from '@newt-kit/newt/core'
import { Tenant_Created } from './events/tenant-created'
import { Tenant_Deleted } from './events/tenant-deleted'
import { Tenant_Renamed } from './events/tenant-renamed'
import { TenantSchema, type TenantDTO } from './tenant.schema'

export * from './tenant.schema'

/** A workspace, and who made it: its admin. */
export class Tenant extends Entity<typeof TenantSchema> {

  private constructor(input: EntityInput<TenantDTO>, isNew: boolean) {
    super(TenantSchema, input, isNew)
  }

  static fromDTO(dto: TenantDTO & { version: number }): Tenant {
    return new Tenant(dto, false)
  }

  static create(input: { name: string, createdBy: string }): Tenant {
    const tenant = new Tenant(input, true)
    tenant.trackEvent(new Tenant_Created(tenant.toDTO()))
    return tenant
  }

  get createdBy(): string {
    return this.data.createdBy
  }

  rename(name: string): void {
    this.change({ name })
    const changes = this.getChanges()
    if (changes) this.trackEvent(new Tenant_Renamed({ dto: this.toDTO(), changes, previous: this.getPrevious()! }))
  }

  /** Deleted softly: its row stays, for whatever other contexts kept of it. */
  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Tenant_Deleted(this.toDTO()))
  }
}
