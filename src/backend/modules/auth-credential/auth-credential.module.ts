import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { AuthCredential } from './auth-credential'
import { AuthCredential_Repository } from './auth-credential.repository'
import { registerAuthCredentialRoutes } from './auth-credential.routes'
import { AuthCredentialChangeSchema, AuthCredentialPasswordSchema, type AuthCredentialChangeDTO } from './auth-credential.schema'
import { AuthCredentialNotFound } from './errors/auth-credential-not-found'
import { WrongPassword } from './errors/wrong-password'
import { AuthCredential_Changed } from './events/auth-credential-changed'

/** Passwords: setting one, checking one, changing one. */
export class AuthCredential_Module extends Module {

  static async initialize(base: Base) {
    // Checking a password for an account that does not exist takes as long as for one
    // that does: nobody learns which accounts exist by timing the answer.
    const decoy = await AuthCredential.create(Bun.randomUUIDv7(), crypto.randomUUID())
    const module = new AuthCredential_Module(base, new AuthCredential_Repository(base), decoy)
    registerAuthCredentialRoutes(base, module)
    return module
  }

  readonly changed

  private constructor(base: Base, private readonly repo: AuthCredential_Repository, private readonly decoy: AuthCredential) {
    super('authCredential', base.transactions)
    this.changed = new DomainEventEmitter(base.bus, AuthCredential_Changed)
  }

  /** The first password of a new account. */
  @UseCase('authCredential.create')
  async create(userId: string, password: string): Promise<void> {
    await this.repo.persist(await AuthCredential.create(userId, AuthCredentialPasswordSchema.parse(password)))
  }

  /** Whether `password` is this user's. `null` (no such user) takes as long and says no. */
  @UseCase('authCredential.verify')
  async verify(userId: string | null, password: string): Promise<boolean> {
    const credential = userId ? await this.repo.findOf(userId) : null
    if (!credential) {
      await this.decoy.verify(password)
      return false
    }
    return credential.verify(password)
  }

  /** The signed-in person changes their own password, knowing the current one. */
  @UseCase('authCredential.change')
  async change(input: AuthCredentialChangeDTO): Promise<void> {
    const { currentPassword, newPassword } = AuthCredentialChangeSchema.parse(input)
    const { userId, sessionId } = currentActor()

    const credential = await this.repo.findOf(userId)
    if (!credential || !(await credential.verify(currentPassword))) throw new WrongPassword()

    await credential.replace(newPassword, sessionId)
    await this.repo.persist(credential)
  }

  /**
   * A new password without the current one, for whoever proved they own the account
   * another way (a reset link). Every session of the account closes.
   */
  @UseCase('authCredential.reset')
  async reset(userId: string, password: string): Promise<void> {
    const credential = await this.repo.findOf(userId)
    if (!credential) throw new AuthCredentialNotFound(userId)

    await credential.replace(AuthCredentialPasswordSchema.parse(password), null)
    await this.repo.persist(credential)
  }
}
