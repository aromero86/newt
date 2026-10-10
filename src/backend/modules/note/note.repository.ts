import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import { Repository } from '../../core/repository/repository'
import { Note } from './note'
import { note } from './infrastructure/note.table'

export interface Note_Criteria {
  id?: string[]
}

export class Note_Repository extends Repository<Base> {

  /** Newest first. `fromId` continues a page: ids are v7, so they sort by time. */
  async find(criteria: Note_Criteria, pagination?: { size: number, fromId: string }): Promise<Note[]> {
    const rows = await this.db
      .select()
      .from(note)
      .where(and(...this.conditions(criteria, pagination)))
      .orderBy(desc(note.id))
      .limit(pagination?.size ?? -1)

    return rows.map(row => Note.fromDTO({
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  async count(criteria: Note_Criteria): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(note)
      .where(and(...this.conditions(criteria)))
    return result?.count ?? 0
  }

  async persist(entity: Note): Promise<Note> {
    const dto = entity.toDTO()

    if (entity.isNew) {
      await this.db.insert(note).values({
        id: dto.id,
        title: dto.title,
        body: dto.body,
        createdAt: dto.createdAt,
        updatedAt: dto.updatedAt,
      })
    } else if (entity.isDeleted) {
      const now = new Date().toISOString()
      await this.db.update(note).set({ deletedAt: now, updatedAt: now }).where(eq(note.id, dto.id))
    } else {
      await this.db
        .update(note)
        .set({ title: dto.title, body: dto.body, updatedAt: dto.updatedAt })
        .where(eq(note.id, dto.id))
    }

    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: Note_Criteria, pagination?: { fromId: string }) {
    const conditions = [isNull(note.deletedAt)]
    if (criteria.id) conditions.push(inArray(note.id, criteria.id))
    if (pagination?.fromId) conditions.push(lt(note.id, pagination.fromId))
    return conditions
  }
}
