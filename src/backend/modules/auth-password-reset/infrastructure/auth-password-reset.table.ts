import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const authPasswordReset = sqliteTable('auth_password_reset', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  cancelledAt: text('cancelled_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
