import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const dimension = sqliteTable('dimension', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const dimensionValue = sqliteTable('dimension__value', {
  id: text('id').primaryKey(),
  dimensionId: text('dimension_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  retiredAt: text('retired_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
