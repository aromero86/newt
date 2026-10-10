import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { Email } from '../../core/value-objects/email/email'
import { User_Created } from './events/user-created'
import { User_Updated } from './events/user-updated'
import { UserSchema, type UserDTO } from './user.schema'

export * from './user.schema'

export class User extends Entity<typeof UserSchema> {

  private constructor(input: EntityInput<UserDTO>, isNew: boolean) {
    super(UserSchema, input, isNew)
  }

  static fromDTO(dto: UserDTO): User {
    return new User(dto, false)
  }

  static create(input: EntityInput<UserDTO>): User {
    const user = new User({ ...input, email: Email.from(input.email) }, true)
    user.trackEvent(new User_Created(user.toDTO()))
    return user
  }

  update(changes: Partial<Omit<UserDTO, 'id'>>): void {
    this.change(changes.email === undefined ? changes : { ...changes, email: Email.from(changes.email) })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new User_Updated({ dto: this.toDTO(), changes: diff }))
  }
}
