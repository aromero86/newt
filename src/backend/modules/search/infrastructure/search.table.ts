import { blob, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** What can be found: each artifact, version, planned change or part of a proposal. Its text is also in search_entry_text (FTS5). */
export const searchEntry = sqliteTable('search_entry', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  kind: text('kind').notNull(),
  targetId: text('target_id').notNull(),
  layer: text('layer').notNull(),
  part: text('part').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
  text: text('text').notNull(),
  contentHash: text('content_hash').notNull(),
  vector: blob('vector', { mode: 'buffer' }),
  model: text('model'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
