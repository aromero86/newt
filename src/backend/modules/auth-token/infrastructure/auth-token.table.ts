import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const authToken = sqliteTable('auth_token', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
