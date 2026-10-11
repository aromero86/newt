import { AuthTokenApi, AuthTokenCreateSchema, type AuthTokenDTO } from '@newt/api/auth-token'
import { toast } from '@newt/ui/components/toast'
import { inject } from '../../../core/injector/inject'
import { FormStore } from '../../../core/form/form-store'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

type State = {
  /** The dialog to make a token is open. */
  creating: boolean
  /** The token just made, with its secret: shown once, until the dialog closes. */
  created: { name: string, secret: string } | null
}

/** The person's access tokens, for AI assistants to act for them through MCP. */
export class SettingsAssistantsService {

  private readonly api = inject(AuthTokenApi)
  private readonly store = new Store<State>({ creating: false, created: null })

  readonly tokens = new ListStore<AuthTokenDTO>(page => this.api.list(page))
  readonly creating = this.store.select('creating')
  readonly created = this.store.select('created')
  readonly form = new FormStore(AuthTokenCreateSchema, { name: '' }, { errorFields: { validation: 'name' } })

  /** Where assistants connect: the MCP entry, on the same origin as the web. */
  readonly url = `${window.location.origin}/mcp`

  async load(): Promise<void> {
    await this.tokens.loadFirstPage()
  }

  start(): void {
    this.form.reset({ name: '' })
    this.store.patch({ creating: true, created: null })
  }

  /** The secret leaves the page with the dialog. */
  close(): void {
    this.store.patch({ creating: false, created: null })
  }

  async create(): Promise<void> {
    await this.form.submit(async input => {
      const { token, secret } = await this.api.create(input)
      this.store.patch({ created: { name: token.name, secret } })
      await this.tokens.loadFirstPage()
    })
  }

  async revoke(token: AuthTokenDTO): Promise<void> {
    try {
      await this.api.revoke(token.id)
      await this.tokens.loadFirstPage()
      toast.success(`${token.name} is revoked: it opens nothing any more`)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
