import { z } from 'zod'
import { Entity, type Email, type EntityInput } from 'newt/core'
import { User_SignedUp } from './events/user-signed-up'
import { UserSchema, type UserDTO } from './user.schema'

export * from './user.schema'

/** The account as it is kept: what anyone sees, and its password's hash. */
const UserEntitySchema = UserSchema.extend({
  /** `Bun.password`'s hash (argon2id): the password itself is never kept. */
  passwordHash: z.string().min(1),
})

export type UserEntityDTO = z.infer<typeof UserEntitySchema>

/** Someone with an account: who they are for every product of cooper. */
export class User extends Entity<typeof UserEntitySchema> {

  private constructor(input: EntityInput<UserEntityDTO>, isNew: boolean) {
    super(UserEntitySchema, input, isNew)
  }

  static fromDTO(dto: UserEntityDTO & { version: number }): User {
    return new User(dto, false)
  }

  /** A new account, with its password already hashed. */
  static signUp(input: { email: Email, name: string, passwordHash: string }): User {
    const user = new User(input, true)
    user.trackEvent(new User_SignedUp(user.contract()))
    return user
  }

  get email(): Email {
    return this.data.email
  }

  get passwordHash(): string {
    return this.data.passwordHash
  }

  /** What anyone else sees of it: never its password's hash. */
  contract(): UserDTO {
    const { passwordHash: _, ...user } = this.toDTO()
    return user
  }
}
