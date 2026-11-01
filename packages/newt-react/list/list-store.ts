import type { Page } from '@newt-kit/newt/contract'
import type { PageRequest } from '../http/page-request'
import { Store } from '../store/store'

type ListState<T> = {
  items: T[]
  hasMore: boolean
  total: number
  /** The first page is on its way. */
  loading: boolean
  /** A further page is on its way. */
  loadingMore: boolean
  loaded: boolean
  failure: string | null
  /** Where the next page starts: the cursor the last page gave, or the id of its last item. */
  cursor: string | undefined
}

/**
 * A list read page by page with a cursor: what every long list shares. A service
 * owns one and says where its pages come from; components read its signals.
 */
export class ListStore<T extends { id: string }> {

  private readonly store = new Store<ListState<T>>({ items: [], hasMore: false, total: 0, loading: false, loadingMore: false, loaded: false, failure: null, cursor: undefined })

  readonly items = this.store.select('items')
  readonly hasMore = this.store.select('hasMore')
  readonly total = this.store.select('total')
  readonly loading = this.store.select('loading')
  readonly loadingMore = this.store.select('loadingMore')
  readonly loaded = this.store.select('loaded')
  readonly failure = this.store.select('failure')

  constructor(
    private readonly fetchPage: (page: PageRequest) => Promise<Page<T>>,
    private readonly size = 20,
  ) {}

  /** Each first page starts a new one: a page asked for in an older one is dropped when it arrives. */
  private generation = 0

  /**
   * Starts over: the first page replaces whatever was shown. The newest call wins,
   * since what it asks for (a filter, a search) may have changed since the last one.
   */
  async loadFirstPage(): Promise<void> {
    const generation = ++this.generation
    this.store.patch({ loading: true, loadingMore: false, failure: null })
    try {
      const page = await this.pagesFrom(undefined)
      if (generation !== this.generation) return
      this.store.patch({ ...page, loaded: true, loading: false })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.patch({
        failure: error instanceof Error ? error.message : 'Could not load the list',
        items: [], hasMore: false, total: 0, cursor: undefined, loaded: false, loading: false,
      })
    }
  }

  /** The next page, where the last one said it starts. */
  async loadMore(): Promise<void> {
    const { hasMore, loading, loadingMore, cursor } = this.store.value
    if (!hasMore || loading || loadingMore || cursor === undefined) return
    const generation = this.generation
    this.store.patch({ loadingMore: true, failure: null })
    try {
      const page = await this.pagesFrom(cursor)
      if (generation !== this.generation) return
      this.store.update(state => ({ ...page, items: [...state.items, ...page.items], loadingMore: false }))
    } catch (error) {
      if (generation !== this.generation) return
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load more', loadingMore: false })
    }
  }

  /**
   * The page from `cursor` on, and the ones after it while they come empty with more
   * to follow: a page may have none of its items left (gone since a search found
   * them), and still say where the next one starts.
   */
  private async pagesFrom(cursor: string | undefined): Promise<Pick<ListState<T>, 'items' | 'hasMore' | 'total' | 'cursor'>> {
    for (;;) {
      const page = await this.fetchPage({ size: this.size, cursor })
      const next = page.nextCursor ?? page.items.at(-1)?.id ?? cursor
      if (page.items.length > 0 || !page.hasMore || next === cursor) return { items: page.items, hasMore: page.hasMore, total: page.total, cursor: next }
      cursor = next
    }
  }

  /** Something new that belongs at the top. */
  prepend(item: T): void {
    this.store.update(state => ({ items: [item, ...state.items], total: state.total + 1 }))
  }

  /** Something shown changed. */
  replace(item: T): void {
    this.store.update(state => ({ items: state.items.map(current => (current.id === item.id ? item : current)) }))
  }

  /** Something shown is gone. */
  remove(id: string): void {
    this.store.update(state => {
      const items = state.items.filter(current => current.id !== id)
      return { items, total: state.total - (state.items.length - items.length) }
    })
  }
}
