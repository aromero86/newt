import { Email, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import { EmailTaken } from './errors/email-taken'
import { UserNotFound } from './errors/user-not-found'
import { User_SignedUp } from './events/user-signed-up'
import { User, UserFilter, UserSignUpSchema, type UserDTO, type UserSignUpDTO } from './user'
import { User_Repository, type UserRow } from './user.repository'

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
    return user.contract()
  }

  /** The account of this email if the password is its own; null otherwise, as slowly either way. */
  @UseCase()
  async verifyPassword(email: string, password: string): Promise<UserDTO | null> {
    const parsed = Email.schema.safeParse(email.trim().toLowerCase())
    const user = parsed.success ? await this.repo.first({ email: parsed.data }) : undefined
    const matches = await Bun.password.verify(password, user?.passwordHash ?? NOBODY)
    return user && matches ? user.contract() : null
  }

  @UseCase()
  async get(id: string): Promise<UserDTO> {
    return (await this.resolve(() => this.repo.find({ id }), () => new UserNotFound(id))).contract()
  }

  /** For other modules and contexts: the ones with these ids, in no order; an id of none is not there. */
  @UseCase()
  async getMany(ids: string[]): Promise<UserDTO[]> {
    if (ids.length === 0) return []
    return (await this.repo.find({ id: { in: [...new Set(ids)] } })).map(user => user.contract())
  }

  /** The account of an email, whatever its case, if there is one. */
  @UseCase()
  async findByEmail(email: string): Promise<UserDTO | null> {
    const parsed = Email.schema.safeParse(email.trim().toLowerCase())
    if (!parsed.success) return null
    return (await this.repo.first({ email: parsed.data }))?.contract() ?? null
  }

  /** Every account, newest first, as the staff look them up: only what `UserFilter` allows. */
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<UserDTO>> {
    const criteria = filter === undefined ? {} : UserFilter.toCriteria<UserRow>(UserFilter.schema.parse(filter))
    const found = await this.repo.page(criteria, page, { newestFirst: true })
    return mapPage(found, user => user.contract())
  }
}
