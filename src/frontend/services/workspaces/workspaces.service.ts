import { computed, type ReadonlySignal } from '@preact/signals-core'
import { ApiError } from '@newt/api/core/api-error'
import { WorkspaceApi, type WorkspaceCreateDTO, type WorkspaceDTO, type WorkspaceMineDTO } from '@newt/api/workspace'
import { inject } from '../../core/injector/inject'
import { ListStore } from '../../core/list/list-store'
import { Store } from '../../core/store/store'

const LAST_KEY = 'newt-last-workspace'

/** A workspace opened by id: its data, or `null` when it does not exist for this person. */
type Opened = Record<string, WorkspaceMineDTO | null>

/**
 * The signed-in person's workspaces: the one owner of that data in the app. The
 * list is read page by page; a workspace opened by its address is read on its
 * own, so it does not depend on being in a loaded page. Belongs to the session,
 * so the session guard provides it, never the root.
 */
export class WorkspacesService {

  private readonly api = inject(WorkspaceApi)
  private readonly opened = new Store<{ byId: Opened }>({ byId: {} })
  private readonly openedById = this.opened.select('byId')
  private readonly cache = new Map<string, ReadonlySignal<WorkspaceMineDTO | null | undefined>>()

  /** The list of the person's workspaces, newest first. */
  readonly list = new ListStore<WorkspaceMineDTO>(page => this.api.mine(page))

  /**
   * One workspace: its data, `null` when it does not exist for this person, or
   * `undefined` while it has not been read. Cached, so asking in render subscribes once.
   */
  workspace(workspaceId: string): ReadonlySignal<WorkspaceMineDTO | null | undefined> {
    if (!this.cache.has(workspaceId)) {
      this.cache.set(workspaceId, computed(() => {
        const opened = this.openedById.value[workspaceId]
        if (opened !== undefined) return opened
        return this.list.items.value.find(workspace => workspace.id === workspaceId)
      }))
    }
    return this.cache.get(workspaceId)!
  }

  /** Reads one workspace by its address, unless it is already known. */
  async open(workspaceId: string): Promise<void> {
    if (this.workspace(workspaceId).peek() !== undefined) return
    try {
      this.remember(workspaceId, await this.api.one(workspaceId))
    } catch (error) {
      // Not found and not a member read the same: the workspace does not exist for them.
      if (error instanceof ApiError && error.status === 404) this.remember(workspaceId, null)
      else throw error
    }
  }

  async create(input: WorkspaceCreateDTO): Promise<WorkspaceMineDTO> {
    const workspace = await this.api.create(input)
    this.list.prepend(workspace)
    this.remember(workspace.id, workspace)
    return workspace
  }

  /** A workspace changed (renamed, archived…): everywhere it shows, it shows the new version. */
  replace(workspace: WorkspaceDTO): void {
    const known = this.workspace(workspace.id).peek()
    if (!known) return
    const updated = { ...known, ...workspace }
    this.list.replace(updated)
    this.remember(workspace.id, updated)
  }

  /** The signed-in person is no longer in it. */
  forget(workspaceId: string): void {
    this.list.remove(workspaceId)
    this.remember(workspaceId, null)
  }

  /** The workspace the person was last in, so the app opens there. */
  rememberVisit(workspaceId: string): void {
    try {
      localStorage.setItem(LAST_KEY, workspaceId)
    } catch {
      // Storage may be unavailable: the app opens the list instead.
    }
  }

  lastVisited(): string | null {
    try {
      return localStorage.getItem(LAST_KEY)
    } catch {
      return null
    }
  }

  private remember(workspaceId: string, workspace: WorkspaceMineDTO | null): void {
    this.opened.update(state => ({ byId: { ...state.byId, [workspaceId]: workspace } }))
  }
}
