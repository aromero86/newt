import { BackofficeUserApi, type UserDTO } from '@cooper/api/backoffice-user'
import { inject } from '@cooper/core/injector/inject'
import { ListStore } from '@cooper/core/list/list-store'
import { Store } from '@cooper/core/store/store'

type UsersState = {
  /** The email or name looked for; empty for every account. */
  text: string
}

/** Every account of cooper, the newest first, or those with an email or a name. */
export class UsersService {

  private readonly api = inject(BackofficeUserApi)
  private readonly store = new Store<UsersState>({ text: '' })

  readonly text = this.store.select('text')
  readonly list = new ListStore<UserDTO>(page => this.api.list(this.store.value.text || undefined, page))

  load(): Promise<void> {
    return this.list.loadFirstPage()
  }

  /** Those whose email or name this is, whole and whatever its case; an empty one shows them all again. */
  search(text: string): Promise<void> {
    this.store.patch({ text: text.trim() })
    return this.list.loadFirstPage()
  }
}
