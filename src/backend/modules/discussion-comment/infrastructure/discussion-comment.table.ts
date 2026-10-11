import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const discussionComment = sqliteTable('discussion_comment', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  discussionId: text('discussion_id').notNull(),
  authorId: text('author_id').notNull(),
  body: text('body').notNull(),
  editedAt: text('edited_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
