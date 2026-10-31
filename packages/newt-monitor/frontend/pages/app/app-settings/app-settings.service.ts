import { inject, FormStore, Store } from 'newt-react'
import { toast } from 'newt-react-ui/toast'
import { z } from 'zod'
import { AppApi, AppRegisterSchema, RepositorySchema, type AppDTO, type AppUpdateDTO } from '../../../api/app'
import { AppService } from '../app.service'

/** The settings' form: a key left empty keeps the one it has, which is never shown; a repository left empty is none. */
const AppSettingsSchema = z.object({
  name: AppRegisterSchema.shape.name,
  url: AppRegisterSchema.shape.url,
  key: z.union([z.literal(''), AppRegisterSchema.shape.key]),
  repository: z.string().superRefine((value, context) => {
    const checked = RepositorySchema.safeParse(value)
    if (!checked.success) context.addIssue({ code: 'custom', message: checked.error.issues[0]!.message })
  }),
})

type SettingsState = {
  confirming: 'archive' | 'delete' | null
  working: boolean
}

/** An application's settings: where it is and its key, checked before they are saved, and its life. */
export class AppSettingsService {

  private readonly api = inject(AppApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<SettingsState>({ confirming: null, working: false })

  readonly confirming = this.store.select('confirming')
  readonly working = this.store.select('working')
  readonly form = new FormStore(AppSettingsSchema, { name: '', url: '', key: '', repository: '' }, {
    errorFields: { 'app.name_taken': 'name', 'app.unreachable': 'url', 'app.bad_answer': 'url', 'app.key_rejected': 'key' },
  })

  edit(app: AppDTO): void {
    this.form.reset({ name: app.name, url: app.url, key: '', repository: app.repository ?? '' })
  }

  /** Saves what changed: a new address or key only once the application answers with them. */
  async save(app: AppDTO): Promise<void> {
    await this.form.submit(async values => {
      const change: AppUpdateDTO = {
        ...(values.name !== app.name ? { name: values.name } : {}),
        ...(values.url !== app.url ? { url: values.url } : {}),
        ...(values.key ? { key: values.key } : {}),
        ...(RepositorySchema.parse(values.repository) !== app.repository ? { repository: values.repository } : {}),
      }
      if (Object.keys(change).length === 0) {
        toast.success('Nothing changed')
        return
      }
      const saved = await this.api.update(app.id, change)
      this.app.replaced(saved)
      this.edit(saved)
      toast.success(change.url || change.key ? 'It answers: saved' : 'Saved')
    })
  }

  ask(what: 'archive' | 'delete'): void {
    this.store.patch({ confirming: what })
  }

  cancel(): void {
    this.store.patch({ confirming: null })
  }

  /** Stops watching it: all that is known of it is kept. */
  archive(app: AppDTO): Promise<boolean> {
    return this.act(async () => {
      this.app.replaced(await this.api.archive(app.id))
      toast.success(`${app.name} is archived`)
    })
  }

  /** Watches it again. */
  restore(app: AppDTO): Promise<boolean> {
    return this.act(async () => {
      this.app.replaced(await this.api.restore(app.id))
      toast.success(`${app.name} is watched again`)
    })
  }

  /** Deletes it, and everything known of it: only an archived one. */
  delete(app: AppDTO): Promise<boolean> {
    return this.act(async () => {
      await this.api.remove(app.id)
      toast.success(`${app.name} is deleted`)
    })
  }

  private async act(action: () => Promise<void>): Promise<boolean> {
    this.store.patch({ working: true })
    try {
      await action()
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      this.store.patch({ working: false, confirming: null })
    }
  }
}
