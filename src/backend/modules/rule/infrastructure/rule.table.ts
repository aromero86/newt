import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const rule = sqliteTable('rule', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  number: integer('number').notNull(),
  featureId: text('feature_id').notNull(),
  currentVersionId: text('current_version_id').notNull(),
  retiredAt: text('retired_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const ruleVersion = sqliteTable('rule__version', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').notNull(),
  version: integer('version').notNull(),
  kind: text('kind').notNull(),
  statement: text('statement').notNull(),
  why: text('why').notNull(),
  criteria: text('criteria').notNull(),
  createdAt: text('created_at').notNull(),
})

export const ruleScope = sqliteTable('rule__scope', {
  versionId: text('version_id').notNull(),
  dimensionId: text('dimension_id').notNull(),
  valueId: text('value_id').notNull(),
}, table => [primaryKey({ columns: [table.versionId, table.valueId] })])
