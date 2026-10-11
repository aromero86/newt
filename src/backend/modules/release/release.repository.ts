import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import type { Base } from '../../base/base'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { Repository } from '../../core/repository/repository'
import { releaseArtifact, release } from './infrastructure/release.table'
import { Release, type ReleaseArtifactDTO } from './release'

export interface Release_Criteria {
  workspaceId?: string
  id?: string[]
  /** Any case. */
  name?: string
  /** Published before this release; ids are v7, so in the order they were published. */
  before?: string
}

export class Release_Repository extends Repository<Base> {

  /** Newest first. */
  async find(criteria: Release_Criteria): Promise<Release[]> {
    const rows = await this.db.select().from(release).where(and(...this.conditions(criteria))).orderBy(desc(release.id))
    return rows.map(row => Release.fromDTO({ ...row, artifacts: null }))
  }

  /** A page of a workspace's releases, newest first. The cursor is a release id. */
  async page(workspaceId: string, page: PageRequest): Promise<Page<Release>> {
    const rows = await this.db
      .select()
      .from(release)
      .where(and(eq(release.workspaceId, workspaceId), ...(page.cursor ? [lt(release.id, page.cursor)] : [])))
      .orderBy(desc(release.id))
      .limit(page.size + 1)
    const [total] = await this.db.select({ total: count() }).from(release).where(eq(release.workspaceId, workspaceId))
    return toPage(rows.map(row => Release.fromDTO({ ...row, artifacts: null })), page.size, total?.total ?? 0)
  }

  /** A release's picture of the definition. */
  async artifacts(releaseId: string): Promise<ReleaseArtifactDTO[]> {
    const rows = await this.db.select().from(releaseArtifact).where(eq(releaseArtifact.releaseId, releaseId))
    return rows.map(row => JSON.parse(row.content) as ReleaseArtifactDTO)
  }

  /** A release is written once, with its picture. */
  async persist(entity: Release): Promise<Release> {
    const { artifacts, ...dto } = entity.toDTO()
    if (entity.isNew) {
      await this.db.insert(release).values(dto)
      if (artifacts?.length) {
        await this.db.insert(releaseArtifact).values(artifacts.map(artifact => ({ releaseId: dto.id, kind: artifact.kind, artifactId: artifact.id, content: JSON.stringify(artifact) })))
      }
    }
    entity.dispatchEvents(this.publisher)
    return entity
  }

  private conditions(criteria: Release_Criteria) {
    const conditions = []
    if (criteria.workspaceId !== undefined) conditions.push(eq(release.workspaceId, criteria.workspaceId))
    if (criteria.id) conditions.push(inArray(release.id, criteria.id))
    if (criteria.name !== undefined) conditions.push(sql`lower(${release.name}) = lower(${criteria.name.trim()})`)
    if (criteria.before !== undefined) conditions.push(lt(release.id, criteria.before))
    return conditions
  }
}
