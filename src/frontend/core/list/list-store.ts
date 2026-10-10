import type { Page } from '@newt/api/core/page'
import type { PageRequest } from '@newt/api/core/page-request'
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
}

/**
 * A list read page by page with a cursor: what every long list shares. A service
 * owns one and says where its pages come from; components read its signals.
 */
export class ListStore<T extends { id: string }> {

  private readonly store = new Store<ListState<T>>({ items: [], hasMore: false, total: 0, loading: false, loadingMore: false, loaded: false, failure: null })

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

  /** Starts over: the first page replaces whatever was shown. */
  async loadFirstPage(): Promise<void> {
    if (this.store.value.loading) return
    this.store.patch({ loading: true, failure: null })
    try {
      const page = await this.fetchPage({ size: this.size })
      this.store.patch({ items: page.items, hasMore: page.hasMore, total: page.total, loaded: true })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load the list' })
    } finally {
      this.store.patch({ loading: false })
    }
  }

  /** The next page, after the last item shown. */
  async loadMore(): Promise<void> {
    const { items, hasMore, loading, loadingMore } = this.store.value
    const last = items.at(-1)
    if (!hasMore || loading || loadingMore || !last) return
    this.store.patch({ loadingMore: true, failure: null })
    try {
      const page = await this.fetchPage({ size: this.size, cursor: last.id })
      this.store.update(state => ({ items: [...state.items, ...page.items], hasMore: page.hasMore, total: page.total }))
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'Could not load more' })
    } finally {
      this.store.patch({ loadingMore: false })
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
