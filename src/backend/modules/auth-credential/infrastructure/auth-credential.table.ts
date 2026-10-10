import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const authCredential = sqliteTable('auth_credential', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
