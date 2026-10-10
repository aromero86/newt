import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  nick: text('nick').notNull(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  bio: text('bio').notNull(),
  deletedAt: text('deleted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
