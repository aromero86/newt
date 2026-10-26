import { Email, eventsOf, Module, UseCase } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { EmailTaken } from './errors/email-taken'
import { UserNotFound } from './errors/user-not-found'
import { User_SignedUp } from './events/user-signed-up'
import { User, UserSignUpSchema, type UserDTO, type UserSignUpDTO } from './user'
import { User_Repository } from './user.repository'

/**
 * A hash to check a password against when there is no account: signing in with an
 * unknown email takes as long as with a wrong password, so the time says nothing.
 */
const NOBODY = await Bun.password.hash('nobody has this password')

/** The accounts: who someone is, for every product of cooper. */
export class User_Module extends Module {

  static initialize(base: AuthBase): User_Module {
    return new User_Module(base, new User_Repository(base))
  }

  readonly events

  private constructor(base: AuthBase, private readonly repo: User_Repository) {
    super('user', base.invocations)
    this.events = eventsOf(base.bus, { signedUp: User_SignedUp })
  }

  /** A new account. `session.signUp` signs it in at once. */
  @UseCase()
  async signUp(input: UserSignUpDTO): Promise<UserDTO> {
    const { email, name, password } = UserSignUpSchema.parse(input)
    const user = User.signUp({ email, name, passwordHash: await Bun.password.hash(password) })
    // For a clear answer in the usual case: the save checks it again, where nothing slips in between.
    if (await this.repo.count({ email: user.email }) > 0) throw new EmailTaken()
    await this.repo.persistWithEmailFree(user)
    return user.toDTO()
  }

  /** The account of this email if the password is its own; null otherwise, as slowly either way. */
  @UseCase()
  async verifyPassword(email: string, password: string): Promise<UserDTO | null> {
    const parsed = Email.schema.safeParse(email.trim().toLowerCase())
    const user = parsed.success ? await this.repo.first({ email: parsed.data }) : undefined
    const matches = await Bun.password.verify(password, user?.passwordHash ?? NOBODY)
    return user && matches ? user.toDTO() : null
  }

  @UseCase()
  async get(id: string): Promise<UserDTO> {
    return (await this.resolve(() => this.repo.find({ id }), () => new UserNotFound(id))).toDTO()
  }
}
