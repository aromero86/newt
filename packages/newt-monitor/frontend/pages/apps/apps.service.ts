import { FormStore, inject, ListStore, Store } from 'newt-react'
import { AppApi, AppRegisterSchema, type AppDTO } from '../../api/app'
import { ConnectionApi, type ConnectionStatusDTO } from '../../api/connection'

/** Which applications the list shows. */
export type AppsFilter = 'active' | 'archived'

type AppsState = {
  filter: AppsFilter
  /** How many there are of each, once counted. */
  counts: Record<AppsFilter, number | null>
  /** Whether each one listed answers, by its id, as each arrives. */
  connections: Record<string, ConnectionStatusDTO['status']>
  /** Whether the dialog to register one is open. */
  registering: boolean
}

/** The applications the monitor watches, or those archived, and registering one. */
export class AppsService {

  private readonly api = inject(AppApi)
  private readonly connectionApi = inject(ConnectionApi)
  private readonly store = new Store<AppsState>({ filter: 'active', counts: { active: null, archived: null }, connections: {}, registering: false })

  readonly filter = this.store.select('filter')
  readonly counts = this.store.select('counts')
  readonly connections = this.store.select('connections')
  readonly registering = this.store.select('registering')
  readonly list = new ListStore<AppDTO>(page => this.api.list(this.store.value.filter, page))
  readonly form = new FormStore(AppRegisterSchema, { name: '', url: '', key: '' }, {
    errorFields: { 'app.name_taken': 'name', 'app.unreachable': 'url', 'app.bad_answer': 'url', 'app.key_rejected': 'key' },
  })

  async load(filter: AppsFilter): Promise<void> {
    this.store.patch({ filter })
    await Promise.all([this.list.loadFirstPage(), this.count()])
    await this.check()
  }

  async loadMore(): Promise<void> {
    await this.list.loadMore()
    await this.check()
  }

  openRegister(): void {
    this.form.reset({ name: '', url: '', key: '' })
    this.store.patch({ registering: true })
  }

  closeRegister(): void {
    this.store.patch({ registering: false })
  }

  /** Resolves to the application, once it answered with its key and is saved; null otherwise. */
  async register(): Promise<AppDTO | null> {
    let registered: AppDTO | null = null
    await this.form.submit(async input => {
      registered = await this.api.register(input)
    })
    if (registered) this.store.patch({ registering: false })
    return registered
  }

  private async count(): Promise<void> {
    const [active, archived] = await Promise.all([this.api.list('active', { size: 1 }), this.api.list('archived', { size: 1 })])
    this.store.patch({ counts: { active: active.total, archived: archived.total } })
  }

  /** Whether those listed and not asked yet answer, all at once. Those archived are not watched. */
  private async check(): Promise<void> {
    if (this.store.value.filter === 'archived') return
    const known = this.store.value.connections
    const ids = this.list.items.peek().map(app => app.id).filter(id => !(id in known))
    const found = await Promise.all(ids.map(id => this.connectionApi.status(id).then(status => [id, status.status] as const, () => null)))
    this.store.update(state => ({ connections: { ...state.connections, ...Object.fromEntries(found.filter(each => each !== null)) } }))
  }
}
