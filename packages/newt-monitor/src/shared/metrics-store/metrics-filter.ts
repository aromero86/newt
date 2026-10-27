import type { DuckDbParam } from 'newt/adapter-duckdb'

/** What a metrics query is about: one event or use case, in a context, maybe one scope's or one actor's. */
export type MetricsFilter = { context: string, name: string, scope?: string, actor?: string }

/**
 * The `WHERE` of a filter, its parameters numbered from `first`: `column` is the name's
 * (`event`, `use_case`); without actor for a table that has none (a day's summary).
 */
export function whereOf(filter: MetricsFilter, column: string, first: number, withActor: boolean): { sql: string, params: DuckDbParam[] } {
  const parts = [`context = $${first}`, `${column} = $${first + 1}`]
  const params: DuckDbParam[] = [filter.context, filter.name]
  if (filter.scope !== undefined) {
    const [name, ...value] = filter.scope.split(':')
    parts.push(`json_extract_string(scopes, $${first + params.length}) = $${first + params.length + 1}`)
    params.push(`$."${name}"`, value.join(':'))
  }
  if (filter.actor !== undefined && withActor) {
    parts.push(`actor = $${first + params.length}`)
    params.push(filter.actor)
  }
  return { sql: parts.join(' AND '), params }
}
