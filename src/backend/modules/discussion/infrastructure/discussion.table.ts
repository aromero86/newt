import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const discussion = sqliteTable('discussion', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  deltaId: text('delta_id'),
  revision: integer('revision').notNull(),
  startedBy: text('started_by').notNull(),
  resolvedAt: text('resolved_at'),
  resolvedBy: text('resolved_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
