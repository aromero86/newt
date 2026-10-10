import type { Base } from '../../base/base'
import { DomainEventEmitter } from '../../core/events/domain-event-emitter'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { EmailTaken } from './errors/email-taken'
import { NickTaken } from './errors/nick-taken'
import { UserNotFound } from './errors/user-not-found'
import { User_Created } from './events/user-created'
import { User_Updated } from './events/user-updated'
import { User, UserCreateSchema, UserUpdateSchema, type UserCreateDTO, type UserUpdateDTO } from './user'
import { User_Repository, type User_Criteria } from './user.repository'
import { registerUserRoutes } from './user.routes'

export class User_Module extends Module {

  static async initialize(base: Base) {
    const module = new User_Module(base, new User_Repository(base))
    registerUserRoutes(base, module)
    return module
  }

  readonly created
  readonly updated

  private constructor(base: Base, private readonly repo: User_Repository) {
    super('user', base.transactions)
    this.created = new DomainEventEmitter(base.bus, User_Created)
    this.updated = new DomainEventEmitter(base.bus, User_Updated)
  }

  @UseCase('user.find')
  async find(criteria: User_Criteria) {
    const users = await this.repo.find(criteria)
    return users.map(user => user.toDTO())
  }

  /** Accounts are created by `auth`, together with their password. */
  @UseCase('user.create')
  async create(input: UserCreateDTO) {
    const data = UserCreateSchema.parse(input)
    await this.assertFree({ nick: data.nick, email: data.email })

    const user = User.create(data)
    await this.repo.persist(user)
    return user.toDTO()
  }

  /** A profile is only edited by its owner: the one signed in. */
  @UseCase('user.updateMine')
  async updateMine(input: UserUpdateDTO) {
    const { userId } = currentActor()
    const changes = UserUpdateSchema.parse(input)
    const user = await this.resolve(() => this.repo.find({ id: [userId] }), () => new UserNotFound(userId))
    await this.assertFree({ nick: changes.nick, email: changes.email }, userId)

    user.update(changes)
    await this.repo.persist(user)
    return user.toDTO()
  }

  /** Nick and email belong to one account each, whatever their case. */
  private async assertFree({ nick, email }: { nick?: string, email?: string }, exceptUserId?: string) {
    const others = (users: User[]) => users.some(user => user.id !== exceptUserId)
    if (nick !== undefined && others(await this.repo.find({ nick }))) throw new NickTaken(nick)
    if (email !== undefined && others(await this.repo.find({ email }))) throw new EmailTaken()
  }
}
