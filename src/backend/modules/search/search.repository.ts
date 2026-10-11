import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { searchEntry } from './infrastructure/search.table'
import { SearchEntry, type SearchEntryData, type SearchKind, type SearchLayer } from './search'

export interface SearchEntry_Criteria {
  workspaceId: string
  id?: string[]
  layers?: SearchLayer[]
  kinds?: SearchKind[]
  targetId?: string
  /** Those without a vector of this model: to compute. */
  missingVectorOf?: string
}

type Row = typeof searchEntry.$inferSelect

/** Rows of the index and their words, kept together: search_entry and search_entry_text (FTS5). */
export class SearchEntry_Repository extends Repository<Base> {

  async find(criteria: SearchEntry_Criteria, limit?: number): Promise<SearchEntry[]> {
    const query = this.db.select().from(searchEntry).where(and(...this.conditions(criteria))).orderBy(searchEntry.id)
    const rows = limit === undefined ? await query : await query.limit(limit)
    return rows.map(row => this.entity(row))
  }

  /** Every workspace that has an index. */
  async workspaceIds(): Promise<string[]> {
    const rows = await this.db.selectDistinct({ workspaceId: searchEntry.workspaceId }).from(searchEntry)
    return rows.map(row => row.workspaceId)
  }

  /** The ids of the workspace's entries whose words match an FTS5 query, best first. */
  async match(workspaceId: string, query: string, limit: number): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(sql`
      select t.entry_id as id from search_entry_text t
      join search_entry e on e.id = t.entry_id
      where search_entry_text match ${query} and e.workspace_id = ${workspaceId}
      order by bm25(search_entry_text) limit ${limit}`)
    return rows.map(row => row.id)
  }

  async persist(entity: SearchEntry): Promise<SearchEntry> {
    const { vector, ...dto } = entity.toDTO()
    const values = { ...dto, vector: vector ? Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength) : null }
    if (entity.isNew) {
      await this.db.insert(searchEntry).values(values)
    } else {
      const { id, workspaceId: _, kind: __, targetId: ___, layer: ____, part: _____, createdAt: ______, ...row } = values
      await this.db.update(searchEntry).set(row).where(eq(searchEntry.id, id))
    }
    if (entity.isNew || entity.hasChanged('text')) {
      await this.db.run(sql`delete from search_entry_text where entry_id = ${dto.id}`)
      await this.db.run(sql`insert into search_entry_text (entry_id, text) values (${dto.id}, ${dto.text})`)
    }
    return entity
  }

  async delete(criteria: SearchEntry_Criteria): Promise<void> {
    const ids = (await this.db.select({ id: searchEntry.id }).from(searchEntry).where(and(...this.conditions(criteria)))).map(row => row.id)
    if (ids.length === 0) return
    await this.db.run(sql`delete from search_entry_text where entry_id in ${ids}`)
    await this.db.delete(searchEntry).where(inArray(searchEntry.id, ids))
  }

  private entity(row: Row): SearchEntry {
    return SearchEntry.fromDTO({
      ...row,
      kind: row.kind as SearchKind,
      layer: row.layer as SearchLayer,
      data: row.data as SearchEntryData,
      vector: row.vector ? new Float32Array(new Uint8Array(row.vector).buffer) : null,
    })
  }

  private conditions(criteria: SearchEntry_Criteria) {
    const conditions = [eq(searchEntry.workspaceId, criteria.workspaceId)]
    if (criteria.id) conditions.push(inArray(searchEntry.id, criteria.id))
    if (criteria.layers) conditions.push(inArray(searchEntry.layer, criteria.layers))
    if (criteria.kinds) conditions.push(inArray(searchEntry.kind, criteria.kinds))
    if (criteria.targetId !== undefined) conditions.push(eq(searchEntry.targetId, criteria.targetId))
    if (criteria.missingVectorOf !== undefined) conditions.push(or(isNull(searchEntry.vector), isNull(searchEntry.model), ne(searchEntry.model, criteria.missingVectorOf))!)
    return conditions
  }
}
