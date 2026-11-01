import type { DuckDbParam } from 'newt-kit/adapter-duckdb'

/** What a metrics query is about: one event or use case, in a context, or all of them (neither given); maybe one scope's or one actor's. */
export type MetricsFilter = { context?: string, name?: string, scope?: string, actor?: string }

/**
 * The `WHERE` of a filter, its parameters numbered from `first`: `column` is the name's
 * (`event`, `use_case`); without actor for a table that has none (a day's summary).
 */
export function whereOf(filter: MetricsFilter, column: string, first: number, withActor: boolean): { sql: string, params: DuckDbParam[] } {
  const parts: string[] = []
  const params: DuckDbParam[] = []
  if (filter.context !== undefined) {
    parts.push(`context = $${first + params.length}`)
    params.push(filter.context)
  }
  if (filter.name !== undefined) {
    parts.push(`${column} = $${first + params.length}`)
    params.push(filter.name)
  }
  if (filter.scope !== undefined) {
    const [name, ...value] = filter.scope.split(':')
    parts.push(`json_extract_string(scopes, $${first + params.length}) = $${first + params.length + 1}`)
    params.push(`$."${name}"`, value.join(':'))
  }
  if (filter.actor !== undefined && withActor) {
    parts.push(`actor = $${first + params.length}`)
    params.push(filter.actor)
  }
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', params }
}
