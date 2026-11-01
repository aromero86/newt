import { TableRepository } from '@newt-kit/newt/repository'
import type { AuthBase } from '../../auth-base'
import { Tenant, type TenantDTO } from './tenant'

export type TenantRow = TenantDTO & { version: number, deletedAt: string | null }

export class Tenant_Repository extends TableRepository<Tenant, TenantRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: these are the tenants themselves; the use cases ask who may see each one.
    super(base, base.store.table<TenantRow>('tenant'), { softDelete: true, scope: 'none' })
  }

  protected toEntity(row: TenantRow): Tenant {
    return Tenant.fromDTO(row)
  }
}
