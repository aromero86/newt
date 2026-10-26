import { TableRepository } from 'newt/repository'
import type { AuthBase } from '../../auth-base'
import { EmailTaken } from './errors/email-taken'
import { User, type UserEntityDTO } from './user'

/** An account as its table keeps it: the email comes back as an `Email`. */
export type UserRow = UserEntityDTO & { version: number }

export class User_Repository extends TableRepository<User, UserRow, AuthBase> {

  constructor(base: AuthBase) {
    // No scope: people belong to no tenant; they are in many.
    super(base, base.store.table<UserRow>('user'), { scope: 'none' })
  }

  protected toEntity(row: UserRow): User {
    return User.fromDTO(row)
  }

  /**
   * Saves an account only if no other one has its email: checked after the write, in
   * its transaction, guarding that email, so two people signing up with it at once
   * cannot both get it. Emails are kept in lower case, so this is whatever the case
   * they were typed in. Any store keeps this rule the same way, with no unique index.
   */
  async persistWithEmailFree(user: User): Promise<void> {
    await this.save([user], each => this.write(each), {
      guard: [`userEmail:${user.email}`],
      after: async () => {
        if (await this.count({ email: user.email }) > 1) throw new EmailTaken()
      },
    })
  }
}
