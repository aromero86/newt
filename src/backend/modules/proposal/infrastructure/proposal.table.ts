import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  document: text('document').notNull(),
  revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const proposalRevision = sqliteTable('proposal__revision', {
  proposalId: text('proposal_id').notNull(),
  number: integer('number').notNull(),
  message: text('message').notNull(),
  document: text('document').notNull(),
  publishedBy: text('published_by').notNull(),
  publishedAt: text('published_at').notNull(),
  added: integer('added').notNull(),
  changed: integer('changed').notNull(),
  removed: integer('removed').notNull(),
  documentChanged: integer('document_changed', { mode: 'boolean' }).notNull(),
}, table => [primaryKey({ columns: [table.proposalId, table.number] })])
