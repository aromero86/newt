import type { Base } from '../../base/base'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { SecretToken } from '../../core/value-objects/secret-token/secret-token'
import { InvalidResetLink } from './errors/invalid-reset-link'
import { AuthPasswordReset_Requested } from './events/auth-password-reset-requested'
import { AuthPasswordReset } from './auth-password-reset'
import type { AuthPasswordReset_Deps } from './auth-password-reset.deps'
import type { AuthPasswordReset_Options } from './auth-password-reset-options'
import { AuthPasswordReset_Repository } from './auth-password-reset.repository'
import { registerAuthPasswordResetRoutes } from './auth-password-reset.routes'
import { AuthPasswordResetCompleteSchema, AuthPasswordResetRequestSchema, type AuthPasswordResetCompleteDTO, type AuthPasswordResetRequestDTO } from './auth-password-reset.schema'
import { registerAuthPasswordResetWorkers } from './auth-password-reset.workers'

/** Getting back into an account without its password, through a link sent by email. */
export class AuthPasswordReset_Module extends Module {

  static async initialize(base: Base, deps: AuthPasswordReset_Deps, options: AuthPasswordReset_Options) {
    const module = new AuthPasswordReset_Module(base, new AuthPasswordReset_Repository(base), deps, options)
    registerAuthPasswordResetRoutes(base, module)
    registerAuthPasswordResetWorkers(module, deps)
    return module
  }

  readonly requested

  private constructor(
    base: Base,
    private readonly repo: AuthPasswordReset_Repository,
    private readonly deps: AuthPasswordReset_Deps,
    readonly options: AuthPasswordReset_Options,
  ) {
    super('authPasswordReset', base.transactions)
    this.requested = new DomainEventEmitter(base.bus, AuthPasswordReset_Requested)
  }

  /**
   * Answers the same whether the email has an account or not. When it has, any
   * pending request is cancelled and a new one is made; its email leaves after the
   * commit, from a worker. The current password keeps working meanwhile.
   */
  @UseCase('authPasswordReset.request')
  async request(input: AuthPasswordResetRequestDTO): Promise<void> {
    const { email } = AuthPasswordResetRequestSchema.parse(input)
    const [user] = await this.deps.user.find({ email })
    if (!user) return

    for (const pending of await this.repo.find({ userId: user.id, pending: true })) {
      pending.cancel()
      await this.repo.persist(pending)
    }
    await this.repo.persist(AuthPasswordReset.request(user, this.options.minutes))
  }

  /** Sets the new password with a usable link, and uses the link up. */
  @UseCase('authPasswordReset.complete')
  async complete(input: AuthPasswordResetCompleteDTO): Promise<void> {
    const { token, password } = AuthPasswordResetCompleteSchema.parse(input)
    if (!SecretToken.schema.safeParse(token).success) throw new InvalidResetLink()

    const [reset] = await this.repo.find({ tokenHash: SecretToken.hash(token) })
    if (!reset || !reset.isUsable()) throw new InvalidResetLink()

    await this.deps.authCredential.reset(reset.userId, password)
    reset.use()
    await this.repo.persist(reset)
  }
}
