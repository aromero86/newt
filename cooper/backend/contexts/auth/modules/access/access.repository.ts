import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { LastStaffNotRevocable } from './errors/last-staff-not-revocable'
import { TenantHasAdmin } from './errors/tenant-has-admin'
import { Access, type AccessDTO } from './access'

export type AccessRow = AccessDTO & { version: number }

export class Access_Repository extends TableRepository<Access, AccessRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: a person's accesses span tenants (and the staff's belong to none); the use cases ask who may see them.
    super(base, base.store.table<AccessRow>('access'), { scope: 'none' })
  }

  protected toEntity(row: AccessRow): Access {
    return Access.fromDTO(row)
  }

  /**
   * Saves new accesses, each one once, keeping every tenant they touch with one admin
   * at most. Each is guarded by its key, which only makes two saves of it wait for
   * each other: what refuses the second row (`DuplicateValue`) is the unique index
   * `access_once` of auth's migrations (SQLite's and Postgres'), on (user, product,
   * tenant) with a null tenant, the staff's, counted as a value. The table declares
   * no `unique`: SQL stores ignore it (their indexes say it), and the files store, the
   * only one that keeps it, lets a row with a null field share its value, so the
   * staff's accesses would go unguarded there. Any other SQL store needs that index
   * in its migrations.
   * The admins are checked after the writes, in their transaction, guarding each
   * tenant's admin, so two saves giving a tenant an admin at once cannot both succeed.
   */
  async persistKeepingOneAdmin(...accesses: Access[]): Promise<void> {
    const tenants = [...new Set(accesses.map(access => access.tenantId).filter(tenantId => tenantId !== null))]
    await this.save(accesses, access => this.write(access), {
      guard: [
        ...accesses.map(access => `access:${access.userId}:${access.productId}:${access.tenantId ?? ''}`),
        ...tenants.map(tenantId => `tenantAdmin:${tenantId}`),
      ],
      after: async () => {
        for (const tenantId of tenants) {
          if (await this.count({ tenantId, role: 'admin' }) > 1) throw new TenantHasAdmin(tenantId)
        }
      },
    })
  }

  /**
   * Saves a staff access taken away, keeping the product with someone of the staff.
   * Whether the actor is staff was a plain read, which two of them revoking each other
   * at once would both pass: so the product's staff is guarded, and checked again
   * after the write, in its transaction. Someone remains, and the actor is still one
   * of them, unless they are the one leaving.
   */
  async persistKeepingOneStaff(access: Access, actorId: string): Promise<void> {
    const { productId } = access
    await this.save([access], each => this.write(each), {
      guard: [`staff:${productId}`],
      after: async () => {
        const remaining = await this.count({ productId, tenantId: null })
        const actorRemains = actorId === access.userId || await this.count({ userId: actorId, productId, tenantId: null }) > 0
        if (remaining === 0 || !actorRemains) throw new LastStaffNotRevocable(productId)
      },
    })
  }
}
