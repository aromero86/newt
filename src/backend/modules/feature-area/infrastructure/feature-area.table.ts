import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const featureArea = sqliteTable('feature_area', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  position: integer('position'),
  activeFeatures: integer('active_features').notNull(),
  retiredAt: text('retired_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
