import { AsyncLocalStorage } from 'node:async_hooks'
import type { Criteria } from '../../core/criteria/criteria'
import { isTracing, traceSpan } from '../../core/traces/trace-recorder'
import type { Store } from '../../port-store/store'
import type { StoredRow } from '../../port-store/stored-row'
import type { Table } from '../../port-store/table'
import { queryShape } from './query-shape'

/** Inside a transaction this store traces: the ones it joins are not spans of their own. */
const inTransaction = new AsyncLocalStorage<true>()

/**
 * A context's store, each read and write of its tables a span of the trace in
 * progress (by its shape: never a value), and each transaction one too, with how
 * long its commit took. Outside a trace, it is the store, as it was. What a
 * repository asks of the adapter's own API is not seen.
 */
export function tracedStore<S extends Store>(store: S, context: string): S {
  return new Proxy(store, {
    get(target, key) {
      if (key === 'table') return <Row extends StoredRow>(name: string, options?: unknown) => tracedTable(target.table<Row>(name, options as never), name, context)
      if (key === 'transaction') return <T>(fn: () => T | Promise<T>) => transaction(target, fn, context)
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function transaction<T>(store: Store, fn: () => T | Promise<T>, context: string): Promise<T> {
  if (!isTracing() || inTransaction.getStore()) return store.transaction(fn)
  let bodyEnded = 0
  return traceSpan(
    { kind: 'transaction', name: 'transaction', context },
    () => inTransaction.run(true, () => store.transaction(async () => {
      const result = await fn()
      bodyEnded = performance.now()
      return result
    })),
    () => ({ commitMs: Math.round((performance.now() - bodyEnded) * 100) / 100 }),
  )
}

function tracedTable<Row extends StoredRow>(table: Table<Row>, name: string, context: string): Table<Row> {
  const step = <T>(operation: string, query: string | null, run: () => Promise<T>, rows?: (result: T) => number): Promise<T> => {
    if (!isTracing()) return run()
    return traceSpan(
      { kind: 'query', name: `${name}.${operation}`, context, attributes: query === null ? {} : { query } },
      run,
      rows ? result => ({ rows: rows(result) }) : undefined,
    )
  }
  const shape = (criteria?: Criteria<Row>, options?: Parameters<Table<Row>['find']>[1]) => (isTracing() ? queryShape(criteria, options) : null)
  return {
    find: (criteria, options) => step('find', shape(criteria, options), () => table.find(criteria, options), rows => rows.length),
    count: criteria => step('count', shape(criteria), () => table.count(criteria), counted => counted),
    insert: row => step('insert', null, () => table.insert(row)),
    update: (id, version, changes) => step('update', null, () => table.update(id, version, changes)),
    patch: (id, changes) => step('patch', null, () => table.patch(id, changes)),
    delete: (id, version) => step('delete', null, () => table.delete(id, version)),
    deleteMany: criteria => step('deleteMany', shape(criteria), () => table.deleteMany(criteria), removed => removed),
  }
}
