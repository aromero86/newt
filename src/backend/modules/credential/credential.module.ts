import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { Credential } from './credential'
import { Credential_Repository } from './credential.repository'
import { registerCredentialRoutes } from './credential.routes'
import { CredentialChangeSchema, CredentialPasswordSchema, type CredentialChangeDTO } from './credential.schema'
import { WrongPassword } from './errors/wrong-password'
import { Credential_Changed } from './events/credential-changed'

/** Passwords: setting one, checking one, changing one. */
export class Credential_Module extends Module {

  static async initialize(base: Base) {
    // Checking a password for an account that does not exist takes as long as for one
    // that does: nobody learns which accounts exist by timing the answer.
    const decoy = await Credential.create(Bun.randomUUIDv7(), crypto.randomUUID())
    const module = new Credential_Module(base, new Credential_Repository(base), decoy)
    registerCredentialRoutes(base, module)
    return module
  }

  readonly changed

  private constructor(base: Base, private readonly repo: Credential_Repository, private readonly decoy: Credential) {
    super('credential', base.transactions)
    this.changed = new DomainEventEmitter(base.bus, Credential_Changed)
  }

  /** The first password of a new account. */
  @UseCase('credential.create')
  async create(userId: string, password: string): Promise<void> {
    await this.repo.persist(await Credential.create(userId, CredentialPasswordSchema.parse(password)))
  }

  /** Whether `password` is this user's. `null` (no such user) takes as long and says no. */
  @UseCase('credential.verify')
  async verify(userId: string | null, password: string): Promise<boolean> {
    const credential = userId ? await this.repo.findOf(userId) : null
    if (!credential) {
      await this.decoy.verify(password)
      return false
    }
    return credential.verify(password)
  }

  /** The signed-in person changes their own password, knowing the current one. */
  @UseCase('credential.change')
  async change(input: CredentialChangeDTO): Promise<void> {
    const { currentPassword, newPassword } = CredentialChangeSchema.parse(input)
    const { userId, sessionId } = currentActor()

    const credential = await this.repo.findOf(userId)
    if (!credential || !(await credential.verify(currentPassword))) throw new WrongPassword()

    await credential.replace(newPassword, sessionId)
    await this.repo.persist(credential)
  }
}
