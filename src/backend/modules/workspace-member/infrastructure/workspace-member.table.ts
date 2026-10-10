import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const workspaceMember = sqliteTable('workspace_member', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  active: integer('active', { mode: 'boolean' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
