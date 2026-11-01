import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { currentActor, Module, now, SecretToken, UseCase, type Actor } from 'newt-kit/core'
import type { AuthBase } from '../../auth-base'
import { WrongCredentials } from './errors/wrong-credentials'
import { Session, SignInSchema, type MeDTO } from './session'
import type { Session_Options } from './session-options'
import { Session_Repository } from './session.repository'
import { registerSessionRoutes } from './session.routes'
import { registerSessionWorkers } from './session.workers'

/**
 * Two texts are the same, told in the same time whatever they are: each one's hash,
 * of one length, compared byte by byte, so how long it takes says nothing of either.
 */
function same(given: string, expected: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

/**
 * Who signs in and their password, told apart without either: an HMAC under the
 * monitor's secret, so a copy of the database says nothing of the password.
 */
export function credentialsOf(user: string, password: string, secret: string): string {
  return createHmac('sha256', secret).update(`${user}\n${password}`).digest('base64url')
}

/**
 * Who is in: the one person the monitor's settings name, with their password, from
 * any number of browsers. Every other route of the context runs as them, or not at all.
 */
export class Session_Module extends Module {

  static initialize(base: AuthBase, options: Session_Options): Session_Module {
    const module = new Session_Module(base, new Session_Repository(base), options)
    registerSessionRoutes(base, module, options)
    registerSessionWorkers(module)
    return module
  }

  /** At three every night (UTC): a schedule, told as an event its workers subscribe to. */
  readonly nightly

  private constructor(base: AuthBase, private readonly repo: Session_Repository, private readonly options: Session_Options) {
    super('session', base.invocations)
    this.nightly = base.schedules.define('session.nightly', '0 3 * * *')
  }

  /**
   * A new session, for the right user and password: its token, for the browser's
   * cookie. Both are checked, each in the same time, so a wrong user answers as late
   * as a wrong password, and neither says which it was.
   */
  @UseCase()
  async signIn(input: unknown): Promise<{ token: SecretToken, me: MeDTO }> {
    const { user, password } = SignInSchema.parse(input)
    const rightUser = same(user, this.options.user)
    const rightPassword = same(password, this.options.password)
    if (!rightUser || !rightPassword) throw new WrongCredentials()
    const { session, token } = Session.open(this.options.hours)
    await this.repo.persist(session)
    return { token, me: { user: this.options.user } }
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
    return { userId: this.options.user }
  }

  /** Who is signed in. */
  @UseCase()
  async me(): Promise<MeDTO> {
    return { user: currentActor().userId }
  }

  /** Ends the session of this token, if it is one: signing out twice is signing out once. */
  @UseCase()
  async signOut(token: string | undefined): Promise<void> {
    const session = await this.find(token)
    if (!session) return
    session.close()
    await this.repo.persist(session)
  }

  /**
   * Removes the sessions that expired: nobody signed out of them, and an expired one
   * is closed only when its browser comes back. What the nightly worker calls; the
   * second time, there are none.
   */
  @UseCase()
  async purgeExpired(): Promise<number> {
    return this.repo.purgeExpired(now())
  }

  /**
   * Whether the monitor started with another user or password than its sessions were
   * opened with: whatever they opened must end. The first time it is asked, nothing
   * was, and it keeps these.
   */
  @UseCase()
  async credentialsChanged(): Promise<boolean> {
    const opened = await this.repo.openedWith()
    if (opened === undefined) await this.repo.openWith(this.options.credentials)
    return opened !== undefined && opened !== this.options.credentials
  }

  /** Ends every session, and the next ones are opened with the credentials the monitor has now: how many it ended. */
  @UseCase()
  async endAll(): Promise<number> {
    return this.repo.endAll(this.options.credentials)
  }

  private async find(token: string | undefined): Promise<Session | undefined> {
    const parsed = SecretToken.schema.safeParse(token)
    return parsed.success ? this.repo.first({ tokenHash: SecretToken.hash(parsed.data) }) : undefined
  }
}
