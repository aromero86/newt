import type { Base } from '../../base/base'
import type { Actor } from '../../core/context/actor'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { UserNotFound } from '../user/errors/user-not-found'
import type { UserDTO } from '../user/user.schema'
import { InvalidCredentials } from './errors/invalid-credentials'
import { AuthSession } from './auth-session'
import type { AuthSession_Deps } from './auth-session.deps'
import type { AuthSession_Options } from './auth-session-options'
import { AuthSession_Repository } from './auth-session.repository'
import { registerAuthSessionRoutes } from './auth-session.routes'
import { AuthSessionSignInSchema, AuthSessionSignUpSchema, type AuthSessionSignInDTO, type AuthSessionSignUpDTO } from './auth-session.schema'
import { registerAuthSessionWorkers } from './auth-session.workers'
import { SecretToken } from '../../core/value-objects/secret-token/secret-token'

/** Who is signed in: signing up, in and out, and who sends each request. */
export class AuthSession_Module extends Module {

  static async initialize(base: Base, deps: AuthSession_Deps, options: AuthSession_Options) {
    const module = new AuthSession_Module(base, new AuthSession_Repository(base), deps, options)
    base.http.authenticateWith(request => module.authenticate(request.cookies.get('newt_session')))
    registerAuthSessionRoutes(base, module)
    registerAuthSessionWorkers(module, deps)
    return module
  }

  private constructor(
    base: Base,
    private readonly repo: AuthSession_Repository,
    private readonly deps: AuthSession_Deps,
    readonly options: AuthSession_Options,
  ) {
    super('authSession', base.transactions)
  }

  /** A new account, signed in at once. */
  @UseCase('authSession.signUp')
  async signUp(input: AuthSessionSignUpDTO): Promise<{ user: UserDTO, token: SecretToken }> {
    const { password, ...profile } = AuthSessionSignUpSchema.parse(input)

    const user = await this.deps.user.create(profile)
    await this.deps.authCredential.create(user.id, password)
    return { user, token: await this.open(user.id) }
  }

  @UseCase('authSession.signIn')
  async signIn(input: AuthSessionSignInDTO): Promise<{ user: UserDTO, token: SecretToken }> {
    const { login, password } = AuthSessionSignInSchema.parse(input)

    const [user] = await this.deps.user.find({ login })
    if (!(await this.deps.authCredential.verify(user?.id ?? null, password)) || !user) throw new InvalidCredentials()

    return { user, token: await this.open(user.id) }
  }

  /** Ends the session the request came with. */
  @UseCase('authSession.signOut')
  async signOut(): Promise<void> {
    const { sessionId } = currentActor()
    if (sessionId) await this.repo.delete({ id: [sessionId] })
  }

  /** The signed-in person. */
  @UseCase('authSession.me')
  async me(): Promise<UserDTO> {
    const { userId } = currentActor()
    return this.resolve(() => this.deps.user.find({ id: [userId] }), () => new UserNotFound(userId))
  }

  /** Every session of a user but `keepSessionId`, or all of them when it is `null`. */
  @UseCase('authSession.closeOthers')
  async closeOthers(userId: string, keepSessionId: string | null): Promise<void> {
    await this.repo.delete(keepSessionId ? { userId, exceptId: keepSessionId } : { userId })
  }

  /** Who sent a request, from its token. An expired session is removed. */
  @UseCase('authSession.authenticate')
  async authenticate(token: string | null | undefined): Promise<Actor | null> {
    if (!token || !SecretToken.schema.safeParse(token).success) return null
    const [session] = await this.repo.find({ tokenHash: SecretToken.hash(token) })
    if (!session) return null
    if (session.isExpired()) {
      await this.repo.delete({ id: [session.id] })
      return null
    }
    return { userId: session.userId, sessionId: session.id }
  }

  private async open(userId: string): Promise<SecretToken> {
    const { session, token } = AuthSession.open(userId, this.options.days)
    await this.repo.persist(session)
    return token
  }
}
