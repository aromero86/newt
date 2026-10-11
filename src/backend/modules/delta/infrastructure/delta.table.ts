import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const delta = sqliteTable('delta', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  kind: text('kind').notNull(),
  operation: text('operation').notNull(),
  targetId: text('target_id').notNull(),
  targetLabel: text('target_label').notNull(),
  before: text('before'),
  after: text('after'),
  published: text('published'),
  removed: integer('removed', { mode: 'boolean' }).notNull(),
  gone: integer('gone', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const deltaReview = sqliteTable('delta__review', {
  deltaId: text('delta_id').notNull(),
  userId: text('user_id').notNull(),
  verdict: text('verdict').notNull(),
  reason: text('reason').notNull(),
  at: text('at').notNull(),
}, table => [primaryKey({ columns: [table.deltaId, table.userId] })])

export const deltaSnapshot = sqliteTable('delta__snapshot', {
  deltaId: text('delta_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  revision: integer('revision').notNull(),
  change: text('change').notNull(),
  content: text('content'),
  previous: text('previous'),
}, table => [primaryKey({ columns: [table.deltaId, table.revision] })])
