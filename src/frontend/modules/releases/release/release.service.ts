import { ApiError } from '@newt/api/core/api-error'
import { ReleaseApi, type ReleaseDTO } from '@newt/api/release'
import { toast } from '@newt/ui/components/toast'
import { downloadDocument } from '../../../components/download-document'
import { inject } from '../../../core/injector/inject'
import { Store } from '../../../core/store/store'

type ReleaseState = {
  workspaceId: string
  /** Undefined while loading; null if there is no such release. */
  release: ReleaseDTO | null | undefined
  /** The definition as this release left it, as a document. */
  specification: { fileName: string, markdown: string } | null
}

/** One release: what it changed, and the definition as it left it. */
export class ReleaseService {

  private readonly api = inject(ReleaseApi)
  private readonly store = new Store<ReleaseState>({ workspaceId: '', release: undefined, specification: null })

  readonly release = this.store.select('release')
  readonly specification = this.store.select('specification')

  async load(workspaceId: string, name: string): Promise<void> {
    this.store.patch({ workspaceId, release: undefined, specification: null })
    try {
      const [release, specification] = await Promise.all([this.api.one(workspaceId, name), this.api.specification(workspaceId, name)])
      this.store.patch({ release, specification })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ release: null })
      else throw error
    }
  }

  downloadSpecification(): void {
    const specification = this.store.value.specification
    if (specification) downloadDocument(specification)
  }

  /** What changed from this release on, newest first. */
  async downloadChangelog(): Promise<void> {
    const { workspaceId, release } = this.store.value
    if (!release) return
    try {
      downloadDocument(await this.api.changelog(workspaceId, release.name))
    } catch (error) {
      toast.error((error as Error).message)
    }
  }
}
