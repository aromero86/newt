import type { Base } from '../../base/base'
import type { Actor } from '../../core/context/actor'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { UserNotFound } from '../user/errors/user-not-found'
import type { UserDTO } from '../user/user.schema'
import { InvalidCredentials } from './errors/invalid-credentials'
import { Session } from './session'
import type { Session_Deps } from './session.deps'
import type { Session_Options } from './session-options'
import { Session_Repository } from './session.repository'
import { registerSessionRoutes } from './session.routes'
import { SessionSignInSchema, SessionSignUpSchema, type SessionSignInDTO, type SessionSignUpDTO } from './session.schema'
import { registerSessionWorkers } from './session.workers'
import { SessionToken } from './value-objects/session-token'

/** Who is signed in: signing up, in and out, and who sends each request. */
export class Session_Module extends Module {

  static async initialize(base: Base, deps: Session_Deps, options: Session_Options) {
    const module = new Session_Module(base, new Session_Repository(base), deps, options)
    base.http.authenticateWith(request => module.authenticate(request.cookies.get('newt_session')))
    registerSessionRoutes(base, module)
    registerSessionWorkers(module, deps)
    return module
  }

  private constructor(
    base: Base,
    private readonly repo: Session_Repository,
    private readonly deps: Session_Deps,
    readonly options: Session_Options,
  ) {
    super('session', base.transactions)
  }

  /** A new account, signed in at once. */
  @UseCase('session.signUp')
  async signUp(input: SessionSignUpDTO): Promise<{ user: UserDTO, token: SessionToken }> {
    const { password, ...profile } = SessionSignUpSchema.parse(input)

    const user = await this.deps.user.create(profile)
    await this.deps.credential.create(user.id, password)
    return { user, token: await this.open(user.id) }
  }

  @UseCase('session.signIn')
  async signIn(input: SessionSignInDTO): Promise<{ user: UserDTO, token: SessionToken }> {
    const { login, password } = SessionSignInSchema.parse(input)

    const [user] = await this.deps.user.find({ login })
    if (!(await this.deps.credential.verify(user?.id ?? null, password)) || !user) throw new InvalidCredentials()

    return { user, token: await this.open(user.id) }
  }

  /** Ends the session the request came with. */
  @UseCase('session.signOut')
  async signOut(): Promise<void> {
    await this.repo.delete({ id: [currentActor().sessionId] })
  }

  /** The signed-in person. */
  @UseCase('session.me')
  async me(): Promise<UserDTO> {
    const { userId } = currentActor()
    return this.resolve(() => this.deps.user.find({ id: [userId] }), () => new UserNotFound(userId))
  }

  /** Every session of a user but one: what changing a password leaves open. */
  @UseCase('session.closeOthers')
  async closeOthers(userId: string, keepSessionId: string): Promise<void> {
    await this.repo.delete({ userId, exceptId: keepSessionId })
  }

  /** Who sent a request, from its token. An expired session is removed. */
  @UseCase('session.authenticate')
  async authenticate(token: string | null | undefined): Promise<Actor | null> {
    if (!token || !SessionToken.schema.safeParse(token).success) return null
    const [session] = await this.repo.find({ tokenHash: SessionToken.hash(token) })
    if (!session) return null
    if (session.isExpired()) {
      await this.repo.delete({ id: [session.id] })
      return null
    }
    return { userId: session.userId, sessionId: session.id }
  }

  private async open(userId: string): Promise<SessionToken> {
    const { session, token } = Session.open(userId, this.options.days)
    await this.repo.persist(session)
    return token
  }
}
