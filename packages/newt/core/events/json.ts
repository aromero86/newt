/**
 * A value that comes back from JSON as it went in: what an event carries. A `handler`
 * gets its event back from the job stored with the save, so a `Date` would arrive as
 * a string: an ISO string is what it carries instead, for both strategies alike.
 * A property left `undefined` is left out. An object here is a `type`: TypeScript
 * does not take an `interface` as one.
 */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json | undefined }
