import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const release = sqliteTable('release', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  publishedBy: text('published_by').notNull(),
  publishedAt: text('published_at').notNull(),
  added: integer('added').notNull(),
  changed: integer('changed').notNull(),
  retired: integer('retired').notNull(),
  restored: integer('restored').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const releaseArtifact = sqliteTable('release__artifact', {
  releaseId: text('release_id').notNull(),
  kind: text('kind').notNull(),
  artifactId: text('artifact_id').notNull(),
  content: text('content').notNull(),
}, table => [primaryKey({ columns: [table.releaseId, table.artifactId] })])
