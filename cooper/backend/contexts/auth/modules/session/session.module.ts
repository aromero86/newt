import { currentActor, Module, SecretToken, UseCase, type Actor } from 'newt/core'
import type { AuthBase } from '../../auth-base'
import type { UserDTO } from '../user/user.schema'
import { InvalidCredentials } from './errors/invalid-credentials'
import { SignUpClosed } from './errors/sign-up-closed'
import { Session } from './session'
import type { Session_Deps } from './session.deps'
import type { Session_Options } from './session-options'
import { Session_Repository } from './session.repository'
import { registerSessionRoutes } from './session.routes'
import { SessionCookie, SessionSignInSchema, SessionSignUpSchema } from './session.schema'

/**
 * Who is signed in to auth itself: signing up, in and out, and who sends each request
 * to auth's API.
 */
export class Session_Module extends Module {

  static initialize(base: AuthBase, deps: Session_Deps, options: Session_Options): Session_Module {
    const module = new Session_Module(base, new Session_Repository(base), deps, options)
    base.http.authenticateWith(request => module.authenticate(request.cookies.get(SessionCookie) ?? undefined))
    registerSessionRoutes(base, module)
    return module
  }

  private constructor(
    base: AuthBase,
    private readonly repo: Session_Repository,
    private readonly deps: Session_Deps,
    readonly options: Session_Options,
  ) {
    super('session', base.invocations)
  }

  /**
   * A new account, signed in at once; on the way to a product, only if it takes new
   * accounts. It writes to `user` without being a worker, on purpose: the person waits
   * for their account and their session in one answer. The account is saved first; if
   * opening the session fails, the account stays, and the person signs in.
   */
  @UseCase({ writesTo: ['user'] })
  async signUp(input: unknown): Promise<{ user: UserDTO, token: SecretToken }> {
    const { productId, ...account } = SessionSignUpSchema.parse(input)
    if (productId !== undefined) {
      const product = await this.deps.product.get(productId)
      if (!product.signUp) throw new SignUpClosed(product.name)
    }

    const user = await this.deps.user.signUp(account)
    return { user, token: await this.open(user.id) }
  }

  @UseCase()
  async signIn(input: unknown): Promise<{ user: UserDTO, token: SecretToken }> {
    const { email, password } = SessionSignInSchema.parse(input)
    const user = await this.deps.user.verifyPassword(email, password)
    if (!user) throw new InvalidCredentials()
    return { user, token: await this.open(user.id) }
  }

  /** Ends the session of this token, if it is one: signing out twice is signing out once. */
  @UseCase()
  async signOut(token: string | undefined): Promise<void> {
    const session = await this.find(token)
    if (!session) return
    session.close()
    await this.repo.persist(session)
  }

  /** The signed-in person. */
  @UseCase()
  async me(): Promise<UserDTO> {
    return this.deps.user.get(currentActor().userId)
  }

  /** Who sent a request, from its cookie's token. An expired session is closed. */
  @UseCase()
  async authenticate(token: string | undefined): Promise<Actor | null> {
    const session = await this.find(token)
    if (!session) return null
    if (session.isExpired()) {
      session.close()
      await this.repo.persist(session)
      return null
    }
    return { userId: session.userId, via: 'web' }
  }

  private async find(token: string | undefined): Promise<Session | undefined> {
    const parsed = SecretToken.schema.safeParse(token)
    return parsed.success ? this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
  }

  private async open(userId: string): Promise<SecretToken> {
    const { session, token } = Session.open(userId, this.options.days)
    await this.repo.persist(session)
    return token
  }
}
