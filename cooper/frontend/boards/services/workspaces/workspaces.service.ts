import { computed, type ReadonlySignal } from '@preact/signals-core'
import { WorkspaceApi, type WorkspaceCreateDTO, type WorkspaceDTO } from '@cooper/api/workspace'
import { inject, Store } from '@newt-kit/react'

type WorkspacesState = {
  items: WorkspaceDTO[]
  loading: boolean
  loaded: boolean
  failure: string | null
}

/**
 * The signed-in person's workspaces: the one owner of that data in the app. A
 * short list by design, so it comes whole; a workspace opened by its address is
 * looked up in it. Belongs to the session, so the session guard provides it.
 */
export class WorkspacesService {

  private readonly api = inject(WorkspaceApi)
  private readonly store = new Store<WorkspacesState>({ items: [], loading: false, loaded: false, failure: null })
  private readonly cache = new Map<string, ReadonlySignal<WorkspaceDTO | null | undefined>>()

  readonly items = this.store.select('items')
  readonly loading = this.store.select('loading')
  readonly loaded = this.store.select('loaded')
  readonly failure = this.store.select('failure')

  /**
   * One workspace: its data, `null` when it is not the person's, or `undefined` while
   * the list has not been read. Cached, so asking in render subscribes once.
   */
  workspace(workspaceId: string): ReadonlySignal<WorkspaceDTO | null | undefined> {
    if (!this.cache.has(workspaceId)) {
      this.cache.set(workspaceId, computed(() => {
        if (!this.loaded.value) return undefined
        return this.items.value.find(workspace => workspace.id === workspaceId) ?? null
      }))
    }
    return this.cache.get(workspaceId)!
  }

  /** Reads the list, unless it is already here. */
  async load(): Promise<void> {
    if (this.store.value.loaded) return
    await this.reload()
  }

  async reload(): Promise<void> {
    if (this.store.value.loading) return
    this.store.patch({ loading: true, failure: null })
    try {
      this.store.patch({ items: await this.api.list(), loaded: true })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load your workspaces' })
    } finally {
      this.store.patch({ loading: false })
    }
  }

  async create(input: WorkspaceCreateDTO): Promise<WorkspaceDTO> {
    const workspace = await this.api.create(input)
    this.store.update(state => ({ items: [workspace, ...state.items] }))
    return workspace
  }

  /** Someone joined one (an invitation): read the list again. */
  async joined(): Promise<void> {
    this.store.patch({ loaded: false })
    await this.reload()
  }

  /** A workspace changed: everywhere it shows, it shows the new version. */
  replace(workspace: WorkspaceDTO): void {
    this.store.update(state => ({ items: state.items.map(each => (each.id === workspace.id ? workspace : each)) }))
  }

  /** The signed-in person is no longer in it, or it is gone. */
  forget(workspaceId: string): void {
    this.store.update(state => ({ items: state.items.filter(each => each.id !== workspaceId) }))
  }
}
