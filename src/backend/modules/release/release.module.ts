import type { Base } from '../../base/base'
import { currentActor } from '../../core/context/current-actor'
import { Module } from '../../core/module/module'
import type { Page } from '../../core/pagination/page'
import type { PageRequest } from '../../core/pagination/page-request'
import { toPage } from '../../core/pagination/to-page'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { NothingToRelease } from './errors/nothing-to-release'
import { ReleaseNameTaken } from './errors/release-name-taken'
import { ReleaseNotFound } from './errors/release-not-found'
import {
  Release,
  ReleasePublishSchema,
  type ReleaseArtifactDTO,
  type ReleaseChangeDTO,
  type ReleaseDocumentDTO,
  type ReleaseDTO,
  type ReleasePublishDTO,
} from './release'
import type { Release_Deps } from './release.deps'
import { Release_Repository } from './release.repository'
import { registerReleaseRoutes } from './release.routes'
import { ReleaseChangelog } from './value-objects/release-changelog'
import { ReleaseDiff } from './value-objects/release-diff'
import { ReleaseSpecification } from './value-objects/release-specification'

/**
 * Releases: pictures of a workspace's definition in force, taken when its product
 * is released. What changed between two releases, or since the last one, is the
 * difference between their pictures. Any member publishes one, until they come from
 * GitHub (phase 31).
 */
export class Release_Module extends Module {

  static async initialize(base: Base, deps: Release_Deps) {
    const module = new Release_Module(base, new Release_Repository(base), deps)
    registerReleaseRoutes(base, module)
    return module
  }

  private constructor(base: Base, private readonly repo: Release_Repository, private readonly deps: Release_Deps) {
    super('release', base.transactions)
  }

  /** A page of the workspace's releases, newest first. */
  @UseCase('release.list')
  async list(workspaceId: string, page: PageRequest): Promise<Page<ReleaseDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const releases = await this.repo.page(workspaceId, page)
    return { ...releases, items: await this.contracts(releases.items) }
  }

  @UseCase('release.get')
  async get(workspaceId: string, name: string): Promise<ReleaseDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return (await this.contracts([await this.load(workspaceId, name)]))[0]!
  }

  /** A page of what changed since the last release: what the next one would publish. */
  @UseCase('release.unpublished')
  async unpublished(workspaceId: string, page: PageRequest): Promise<Page<ReleaseChangeDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return pageOf(await this.unreleasedChanges(workspaceId), page)
  }

  /** A page of what a release changed since the one before it. */
  @UseCase('release.changes')
  async changes(workspaceId: string, name: string, page: PageRequest): Promise<Page<ReleaseChangeDTO>> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    return pageOf(await this.releaseChanges(workspaceId, await this.load(workspaceId, name)), page)
  }

  /** A picture of the definition in force, with a name. Only when something changed since the last one. */
  @UseCase('release.publish')
  async publish(workspaceId: string, input: ReleasePublishDTO): Promise<ReleaseDTO> {
    await this.deps.workspace.assertWritable(workspaceId)
    const { name, description } = ReleasePublishSchema.parse(input)
    if ((await this.repo.find({ workspaceId, name })).length) throw new ReleaseNameTaken(name)

    const [last] = await this.repo.find({ workspaceId })
    const artifacts = await this.picture(workspaceId)
    const changes = ReleaseDiff.from({ before: last ? await this.repo.artifacts(last.id) : [], after: artifacts })
    if (changes.length === 0) throw new NothingToRelease()

    const count = (change: ReleaseChangeDTO['change']) => changes.filter(each => each.change === change).length
    const release = Release.publish({
      workspaceId,
      name,
      description,
      publishedBy: currentActor().userId,
      added: count('added'),
      changed: count('changed'),
      retired: count('retired'),
      restored: count('restored'),
      artifacts,
    })
    await this.repo.persist(release)
    return (await this.contracts([release]))[0]!
  }

  /** The definition as a document: as a release left it, or as it is now (`name` null). */
  @UseCase('release.specification')
  async specification(workspaceId: string, name: string | null): Promise<ReleaseDocumentDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const workspace = await this.deps.workspace.get(workspaceId)
    if (!name) return ReleaseSpecification.from({ workspaceName: workspace.name, release: null, artifacts: await this.picture(workspaceId) })

    const release = await this.load(workspaceId, name)
    return ReleaseSpecification.from({ workspaceName: workspace.name, release: { name: release.name, publishedAt: release.publishedAt }, artifacts: await this.repo.artifacts(release.id) })
  }

  /** What changed, newest first: what is not released yet, then each release down to `since`, or all of them. */
  @UseCase('release.changelog')
  async changelog(workspaceId: string, since: string | null): Promise<ReleaseDocumentDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const workspace = await this.deps.workspace.get(workspaceId)
    const releases = await this.repo.find({ workspaceId })
    const until = since ? releases.findIndex(release => release.name.toLowerCase() === since.trim().toLowerCase()) : releases.length - 1
    if (since && until < 0) throw new ReleaseNotFound(since)

    const sections: Parameters<typeof ReleaseChangelog.from>[0]['sections'] = [{ release: null, changes: await this.unreleasedChanges(workspaceId) }]
    for (const release of releases.slice(0, until + 1)) {
      const { description } = release.toDTO()
      sections.push({ release: { name: release.name, description, publishedAt: release.publishedAt }, changes: await this.releaseChanges(workspaceId, release) })
    }
    return ReleaseChangelog.from({ workspaceName: workspace.name, sections })
  }

  private load(workspaceId: string, name: string): Promise<Release> {
    return this.resolve(() => this.repo.find({ workspaceId, name }), () => new ReleaseNotFound(name))
  }

  /** Since the last release, up to now. */
  private async unreleasedChanges(workspaceId: string): Promise<ReleaseChangeDTO[]> {
    const [last] = await this.repo.find({ workspaceId })
    const changes = ReleaseDiff.from({ before: last ? await this.repo.artifacts(last.id) : [], after: await this.picture(workspaceId) })
    return this.withProposals(workspaceId, changes, last?.publishedAt ?? null, null)
  }

  /** From the release before it to this one. */
  private async releaseChanges(workspaceId: string, release: Release): Promise<ReleaseChangeDTO[]> {
    const [previous] = await this.repo.find({ workspaceId, before: release.id })
    const changes = ReleaseDiff.from({ before: previous ? await this.repo.artifacts(previous.id) : [], after: await this.repo.artifacts(release.id) })
    return this.withProposals(workspaceId, changes, previous?.publishedAt ?? null, release.publishedAt)
  }

  /** Each change with the proposals merged in that period that touched its artifact. */
  private async withProposals(workspaceId: string, changes: ReleaseChangeDTO[], after: string | null, until: string | null): Promise<ReleaseChangeDTO[]> {
    if (changes.length === 0) return changes
    const merged = await this.deps.baseline.mergedChanges(workspaceId, after, until)
    return changes.map(change => {
      const proposals = merged.filter(each => each.targetId === change.id).map(each => each.proposal)
      return { ...change, proposals: [...new Map(proposals.map(proposal => [proposal.key, proposal])).values()] }
    })
  }

  /** The definition in force right now, artifact by artifact, retired ones too. */
  private async picture(workspaceId: string): Promise<ReleaseArtifactDTO[]> {
    const [dimensions, areas, features, rules] = await Promise.all([
      this.deps.dimension.list(workspaceId),
      this.deps.featureArea.find(workspaceId, {}),
      this.deps.feature.find(workspaceId, {}),
      this.deps.rule.find(workspaceId, {}),
    ])
    const areaNames = new Map(areas.map(area => [area.id, area.name]))
    const featureAreas = new Map(features.map(feature => [feature.id, feature.areaId]))
    return [
      ...dimensions.map(dimension => ({
        kind: 'dimension' as const,
        id: dimension.id,
        name: dimension.name,
        values: dimension.values.map(value => ({ id: value.id, name: value.name, retired: value.retiredAt !== null })),
        retired: false,
      })),
      ...areas.map(area => ({ kind: 'feature-area' as const, id: area.id, name: area.name, description: area.description, retired: area.retiredAt !== null })),
      ...features.map(feature => ({
        kind: 'feature' as const,
        id: feature.id,
        areaId: feature.areaId,
        areaName: areaNames.get(feature.areaId) ?? '',
        name: feature.name,
        description: feature.description,
        retired: feature.retiredAt !== null,
      })),
      ...rules.map(rule => ({
        kind: 'rule' as const,
        id: rule.id,
        key: rule.key,
        featureId: rule.featureId,
        featureName: rule.featureName,
        areaName: areaNames.get(featureAreas.get(rule.featureId) ?? '') ?? '',
        ruleKind: rule.current.kind,
        statement: rule.current.statement,
        why: rule.current.why,
        scope: rule.current.scope,
        criteria: rule.current.criteria,
        retired: rule.retiredAt !== null,
      })),
    ]
  }

  /** With the nick of who published each. */
  private async contracts(releases: Release[]): Promise<ReleaseDTO[]> {
    if (releases.length === 0) return []
    const dtos = releases.map(release => release.toDTO())
    const nicks = new Map((await this.deps.user.find({ id: [...new Set(dtos.map(dto => dto.publishedBy))] })).map(user => [user.id, user.nick]))
    return dtos.map(({ artifacts: _, publishedBy, added, changed, retired, restored, ...dto }) => ({
      ...dto,
      publishedBy: { id: publishedBy, nick: nicks.get(publishedBy) ?? '' },
      changes: { added, changed, retired, restored },
    }))
  }
}

/** A page of changes already in order: after the one with the cursor's id. */
function pageOf(changes: ReleaseChangeDTO[], page: PageRequest): Page<ReleaseChangeDTO> {
  const start = page.cursor ? changes.findIndex(change => change.id === page.cursor) + 1 : 0
  return toPage(changes.slice(start, start + page.size + 1), page.size, changes.length)
}
