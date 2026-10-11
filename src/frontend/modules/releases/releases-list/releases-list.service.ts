import { ReleaseApi, ReleasePublishSchema, type ReleaseDTO } from '@newt/api/release'
import { toast } from '@newt/ui/components/toast'
import { z } from 'zod'
import { downloadDocument } from '../../../components/download-document'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

// The form always sends both fields.
const PublishSchema = ReleasePublishSchema.extend({ description: z.string().trim().max(2000, 'Keep it under 2000 characters') })

/** A workspace's releases, newest first; publishing the next one; and the documents. */
export class ReleasesListService {

  private readonly api = inject(ReleaseApi)
  private readonly store = new Store({ workspaceId: '', version: 0, publishing: false })

  /** Grows each time a release is published: what is not released yet is read again. */
  readonly version = this.store.select('version')
  readonly publishing = this.store.select('publishing')
  readonly releases = new ListStore<ReleaseDTO>(page => this.api.list(this.store.value.workspaceId, page))
  readonly form = new FormStore(PublishSchema, { name: '', description: '' }, {
    errorFields: { 'release.name_taken': 'name', 'release.nothing_to_release': 'name', 'workspace.archived': 'name', validation: 'name' },
  })

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId })
    this.form.reset({ name: '', description: '' })
    await this.releases.loadFirstPage()
  }

  /** Resolves to the new release, if it was published. */
  async publish(): Promise<ReleaseDTO | undefined> {
    let published: ReleaseDTO | undefined
    await this.form.submit(async input => {
      published = await this.api.publish(this.store.value.workspaceId, input)
    })
    if (!published) return undefined
    this.closePublish()
    this.store.update(({ version }) => ({ version: version + 1 }))
    await this.releases.loadFirstPage()
    toast.success(`${published.name} published`)
    return published
  }

  openPublish(): void {
    this.form.reset({ name: '', description: '' })
    this.store.patch({ publishing: true })
  }

  closePublish(): void {
    this.store.patch({ publishing: false })
  }

  async downloadSpecification(): Promise<void> {
    await this.download(() => this.api.specification(this.store.value.workspaceId))
  }

  async downloadChangelog(): Promise<void> {
    await this.download(() => this.api.changelog(this.store.value.workspaceId))
  }

  private async download(read: () => Promise<{ fileName: string, markdown: string }>): Promise<void> {
    try {
      downloadDocument(await read())
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
