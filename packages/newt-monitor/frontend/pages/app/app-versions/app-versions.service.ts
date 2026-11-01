import { ApiError, inject, ListStore, Store } from 'newt-kit-react'
import { StructureApi, type StructureVersionDTO, type StructureVersionSummaryDTO } from '../../../api/structure'
import { AppService } from '../app.service'

type VersionState = {
  /** The version shown; undefined while it loads, null if there is none such. */
  version: StructureVersionDTO | null | undefined
  /** The one before it; null for the first. */
  previous: StructureVersionDTO | null
  failure: string | null
}

/** An application's versions, the newest first, and one of them beside the one before it. */
export class AppVersionsService {

  private readonly api = inject(StructureApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<VersionState>({ version: undefined, previous: null, failure: null })

  readonly version = this.store.select('version')
  readonly previous = this.store.select('previous')
  readonly failure = this.store.select('failure')
  /** The latest open(): an earlier one that ends after it changes nothing. */
  private opening = 0

  readonly list = new ListStore<StructureVersionSummaryDTO>(page => this.api.versions(this.app.appId, page))

  load(): Promise<void> {
    return this.list.loadFirstPage()
  }

  /** A version, and the one before it: found going back through the list, page by page. */
  async open(versionId: string): Promise<void> {
    const opening = ++this.opening
    this.store.patch({ version: undefined, previous: null, failure: null })
    const appId = this.app.appId
    try {
      const version = await this.api.version(appId, versionId)
      let previousId: string | undefined
      let cursor: string | undefined
      let found = false
      do {
        const page = await this.api.versions(appId, { size: 100, cursor })
        const index = page.items.findIndex(each => each.id === versionId)
        if (found) previousId = page.items[0]?.id
        else if (index >= 0) {
          found = true
          previousId = page.items[index + 1]?.id
        }
        cursor = page.hasMore && previousId === undefined ? page.nextCursor ?? page.items.at(-1)?.id : undefined
      } while (cursor)
      const previous = previousId ? await this.api.version(appId, previousId) : null
      if (opening === this.opening) this.store.patch({ version, previous })
    } catch (error) {
      if (opening !== this.opening) return
      if (error instanceof ApiError && error.status === 404) this.store.patch({ version: null })
      else this.store.patch({ version: null, failure: error instanceof Error ? error.message : 'Could not load the version' })
    }
  }
}
