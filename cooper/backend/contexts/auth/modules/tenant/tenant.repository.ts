import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { Tenant, type TenantDTO } from './tenant'

export type TenantRow = TenantDTO & { version: number, deletedAt: string | null }

export class Tenant_Repository extends TableRepository<Tenant, TenantRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<TenantRow>('tenant'), { softDelete: true })
  }

  protected toEntity(row: TenantRow): Tenant {
    return Tenant.fromDTO(row)
  }
}
