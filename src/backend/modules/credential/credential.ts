import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { Credential_Changed } from './events/credential-changed'

// Not part of the contract: a password hash never leaves the module.
const CredentialEntitySchema = z.object({
  id: z.uuidv7(),
  userId: z.uuidv7(),
  passwordHash: z.string().min(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type CredentialEntityDTO = z.infer<typeof CredentialEntitySchema>

/** A user's password, hashed. */
export class Credential extends Entity<typeof CredentialEntitySchema> {

  private constructor(input: EntityInput<CredentialEntityDTO>, isNew: boolean) {
    super(CredentialEntitySchema, input, isNew)
  }

  static fromDTO(dto: CredentialEntityDTO): Credential {
    return new Credential(dto, false)
  }

  static async create(userId: string, password: string): Promise<Credential> {
    return new Credential({ userId, passwordHash: await Bun.password.hash(password) }, true)
  }

  get userId(): string {
    return this.data.userId
  }

  verify(password: string): Promise<boolean> {
    return Bun.password.verify(password, this.data.passwordHash)
  }

  /** A new password, set from `sessionId`: whoever reacts knows which session did it. */
  async replace(password: string, sessionId: string): Promise<void> {
    this.change({ passwordHash: await Bun.password.hash(password) })
    this.trackEvent(new Credential_Changed({ userId: this.data.userId, sessionId }))
  }
}
