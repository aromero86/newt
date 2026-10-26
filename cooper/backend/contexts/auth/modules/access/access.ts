import { Entity, type EntityInput } from 'newt/core'
import { Access_Granted } from './events/access-granted'
import { Access_Revoked } from './events/access-revoked'
import { AccessSchema, type AccessDTO, type AccessRole } from './access.schema'

export * from './access.schema'

/** Someone's access to a product, for one of its tenants or for all of it. */
export class Access extends Entity<typeof AccessSchema> {

  private constructor(input: EntityInput<AccessDTO>, isNew: boolean) {
    super(AccessSchema, input, isNew)
  }

  static fromDTO(dto: AccessDTO & { version: number }): Access {
    return new Access(dto, false)
  }

  static grant(input: { userId: string, productId: string, tenantId: string | null, role: AccessRole }): Access {
    const access = new Access(input, true)
    access.trackEvent(new Access_Granted(access.toDTO()))
    return access
  }

  get userId(): string {
    return this.data.userId
  }

  get tenantId(): string | null {
    return this.data.tenantId
  }

  get role(): AccessRole {
    return this.data.role
  }

  /** From then on it opens nothing. Accesses are not history: its row goes. */
  revoke(): void {
    this.markAsDeleted()
    this.trackEvent(new Access_Revoked(this.toDTO()))
  }
}
