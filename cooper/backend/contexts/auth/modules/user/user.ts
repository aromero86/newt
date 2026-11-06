import { z } from 'zod'
import { Email, Entity, type EntityInput } from '@newt-kit/newt/core'
import { User_SignedUp } from './events/user-signed-up'
import { UserSchema } from './user.schema'

export * from './user.schema'

/** The account as it is kept: what anyone sees, and its password's hash. */
const UserEntitySchema = UserSchema.extend({
  /** `Bun.password`'s hash (argon2id): the password itself is never kept. */
  passwordHash: z.string().min(1),
})

export type UserEntityDTO = z.infer<typeof UserEntitySchema>

/** Someone with an account: who they are for every product of cooper. */
export class User extends Entity<typeof UserEntitySchema, typeof UserSchema> {

  private constructor(input: EntityInput<UserEntityDTO>, isNew: boolean) {
    super(UserEntitySchema, input, isNew, UserSchema)
  }

  static fromDTO(dto: UserEntityDTO & { version: number }): User {
    return new User(dto, false)
  }

  /** A new account, with its password already hashed: the email as someone typed it becomes an `Email`. */
  static signUp(input: { email: string, name: string, passwordHash: string }): User {
    const user = new User({ ...input, email: Email.from(input.email), avatarUrl: null }, true)
    user.trackEvent(new User_SignedUp(user.toDTO()))
    return user
  }

  get email(): Email {
    return this.data.email
  }

  get passwordHash(): string {
    return this.data.passwordHash
  }

  /** Their picture is read from here now. */
  changeAvatar(avatarUrl: string | null): void {
    this.change({ avatarUrl })
  }
}
