import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const credential = sqliteTable('credential', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
