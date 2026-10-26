/**
 * What happens when a save that guards nothing reads other rows in its transaction (a
 * rule over several rows, checked without its `guard`): an error (`error`, the
 * default), a warning once for each use case and what it read (`warn`), or nothing
 * (`off`). SQLite and files run saves one at a time, so such a save works there and
 * breaks unseen on Postgres and MySQL, where they run side by side: this tells it on
 * every store.
 */
export type GuardRule = 'off' | 'warn' | 'error'
