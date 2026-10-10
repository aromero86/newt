import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, max, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { rule, ruleScope, ruleVersion } from './infrastructure/rule.table'
import { Rule, type RuleFilter, type RuleKind, type RuleVersionDTO } from './rule'

export interface Rule_Criteria {
  workspaceId?: string
  id?: string[]
  number?: number
}

type RuleRow = typeof rule.$inferSelect

export class Rule_Repository extends Repository<Base> {

  async find(criteria: Rule_Criteria): Promise<Rule[]> {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(rule.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(rule.id, criteria.id))
    if (criteria.number !== undefined) conditions.push(eq(rule.number, criteria.number))
    return this.hydrate(await this.db.select().from(rule).where(and(...conditions)).orderBy(asc(rule.number)))
  }

  /**
   * A page of a workspace's rules, by number. A rule applies in a value when its
   * current version names that value, or does not name its dimension at all.
   */
  async page(workspaceId: string, filter: RuleFilter, page: PageRequest): Promise<Page<Rule>> {
    const conditions = [
      eq(rule.workspaceId, workspaceId),
      filter.retired ? isNotNull(rule.retiredAt) : isNull(rule.retiredAt),
      ...(filter.featureId ? [eq(rule.featureId, filter.featureId)] : []),
      ...filter.appliesIn.map(({ dimensionId, valueId }) => sql`(
        not exists (select 1 from rule__scope s where s.version_id = ${rule.currentVersionId} and s.dimension_id = ${dimensionId})
        or exists (select 1 from rule__scope s where s.version_id = ${rule.currentVersionId} and s.value_id = ${valueId})
      )`),
    ]
    // Ids are v7: by id is the order they were created in, the order of their numbers.
    const rows = await this.db
      .select()
      .from(rule)
      .where(and(...conditions, ...(page.cursor ? [gt(rule.id, page.cursor)] : [])))
      .orderBy(asc(rule.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(rule).where(and(...conditions))
    return toPage(await this.hydrate(rows), page.size, total?.total ?? 0)
  }

  /** A page of a rule's versions, newest first. The cursor is a version id. */
  async versions(ruleId: string, page: PageRequest): Promise<Page<RuleVersionDTO>> {
    const rows = await this.db
      .select()
      .from(ruleVersion)
      .where(and(eq(ruleVersion.ruleId, ruleId), ...(page.cursor ? [lt(ruleVersion.id, page.cursor)] : [])))
      .orderBy(desc(ruleVersion.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(ruleVersion).where(eq(ruleVersion.ruleId, ruleId))
    const versions = await this.withScopes(rows)
    return toPage(rows.map(row => versions.get(row.id)!), page.size, total?.total ?? 0)
  }

  /** The next R-number of the workspace: numbers are never reused. */
  async nextNumber(workspaceId: string): Promise<number> {
    const [result] = await this.db.select({ last: max(rule.number) }).from(rule).where(eq(rule.workspaceId, workspaceId))
    return (result?.last ?? 0) + 1
  }

  /** Versions are only ever added: a new current version is a new row. */
  async persist(entity: Rule): Promise<Rule> {
    const dto = entity.toDTO()
    const row = { featureId: dto.featureId, currentVersionId: dto.current.id, retiredAt: dto.retiredAt, updatedAt: dto.updatedAt }

    // The rule first: its versions point at it.
    if (entity.isNew) {
      await this.db.insert(rule).values({ id: dto.id, workspaceId: dto.workspaceId, number: dto.number, ...row, createdAt: dto.createdAt })
      await this.insertVersion(dto.id, dto.current)
    } else {
      if (entity.hasChanged('current')) await this.insertVersion(dto.id, dto.current)
      await this.db.update(rule).set(row).where(eq(rule.id, dto.id))
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private async insertVersion(ruleId: string, version: RuleVersionDTO): Promise<void> {
    const { scope, criteria, ...rest } = version
    await this.db.insert(ruleVersion).values({ ...rest, ruleId, criteria: JSON.stringify(criteria) })
    const scopes = scope.flatMap(({ dimensionId, valueIds }) => valueIds.map(valueId => ({ versionId: version.id, dimensionId, valueId })))
    if (scopes.length) await this.db.insert(ruleScope).values(scopes)
  }

  private async hydrate(rows: RuleRow[]): Promise<Rule[]> {
    if (rows.length === 0) return []
    const versionRows = await this.db.select().from(ruleVersion).where(inArray(ruleVersion.id, rows.map(row => row.currentVersionId)))
    const versions = await this.withScopes(versionRows)
    return rows.map(({ currentVersionId, ...row }) => Rule.fromDTO({ ...row, current: versions.get(currentVersionId)! }))
  }

  /** Versions with their scopes, which keep the order they were written in. */
  private async withScopes(rows: (typeof ruleVersion.$inferSelect)[]): Promise<Map<string, RuleVersionDTO>> {
    const scopes = rows.length
      ? await this.db.select().from(ruleScope).where(inArray(ruleScope.versionId, rows.map(row => row.id))).orderBy(sql`rowid`)
      : []
    return new Map(rows.map(({ ruleId: _, criteria, kind, ...row }) => {
      const scope: RuleVersionDTO['scope'] = []
      for (const each of scopes.filter(candidate => candidate.versionId === row.id)) {
        const entry = scope.find(candidate => candidate.dimensionId === each.dimensionId)
        if (entry) entry.valueIds.push(each.valueId)
        else scope.push({ dimensionId: each.dimensionId, valueIds: [each.valueId] })
      }
      return [row.id, { ...row, kind: kind as RuleKind, criteria: JSON.parse(criteria), scope }]
    }))
  }
}
