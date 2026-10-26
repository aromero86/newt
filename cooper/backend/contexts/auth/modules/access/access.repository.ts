import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { TenantHasAdmin } from './errors/tenant-has-admin'
import { Access, type AccessDTO } from './access'

export type AccessRow = AccessDTO & { version: number }

export class Access_Repository extends TableRepository<Access, AccessRow, AuthBase> {

  constructor(base: AuthBase) {
    super(base, base.store.table<AccessRow>('access'))
  }

  protected toEntity(row: AccessRow): Access {
    return Access.fromDTO(row)
  }

  /**
   * Saves accesses keeping every tenant they touch with one admin at most: checked
   * after the writes, in their transaction, guarding each tenant's admin, so two
   * saves giving a tenant an admin at once cannot both succeed.
   */
  async persistKeepingOneAdmin(...accesses: Access[]): Promise<void> {
    const tenants = [...new Set(accesses.map(access => access.tenantId).filter(tenantId => tenantId !== null))]
    await this.save(accesses, access => this.write(access), {
      guard: tenants.map(tenantId => `tenantAdmin:${tenantId}`),
      after: async () => {
        for (const tenantId of tenants) {
          if (await this.count({ tenantId, role: 'admin' }) > 1) throw new TenantHasAdmin(tenantId)
        }
      },
    })
  }
}
