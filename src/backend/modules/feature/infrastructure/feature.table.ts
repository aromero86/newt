import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const feature = sqliteTable('feature', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  areaId: text('area_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  position: integer('position'),
  retiredAt: text('retired_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
