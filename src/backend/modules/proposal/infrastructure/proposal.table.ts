import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const proposal = sqliteTable('proposal', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull(),
  quick: integer('quick', { mode: 'boolean' }).notNull(),
  createdBy: text('created_by').notNull(),
  acceptedBy: text('accepted_by'),
  acceptedAt: text('accepted_at'),
  mergedBy: text('merged_by'),
  mergedAt: text('merged_at'),
  discardedBy: text('discarded_by'),
  discardedAt: text('discarded_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
