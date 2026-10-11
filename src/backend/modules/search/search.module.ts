import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import type { PageRequest } from '../../core/pagination/page-request'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import type { DeltaDTO } from '../delta/delta.schema'
import type { RuleScopeDTO } from '../rule/rule.schema'
import { Embedder } from './infrastructure/embedder'
import { SearchEntry, SearchFilterSchema, type SearchEntryData, type SearchEntryDraft, type SearchFilterDTO, type SearchLayer, type SearchPageDTO, type SearchResultDTO } from './search'
import type { Search_Deps } from './search.deps'
import type { Search_Options } from './search-options'
import { SearchEntry_Repository } from './search.repository'
import { registerSearchRoutes } from './search.routes'
import { closeness, ruleText, sectionsOf, snippetOf, wordsQuery } from './search-text'
import { registerSearchWorkers } from './search.workers'

/** Below this closeness, a result is not about what was searched. */
const MIN_CLOSENESS = 0.2
/** Below this closeness, two artifacts do not talk about the same thing: texts of the definition are closer to each other than to a search. */
const MIN_SIMILARITY = 0.45
/** How many matches each way of searching brings before they are combined. */
const CANDIDATES = 300
/** How many vectors are computed at a time. */
const BATCH = 16

const nothing: Omit<SearchEntryData, 'label' | 'status'> = { key: null, featureId: null, scope: null, proposal: null, version: null, currentVersion: null }

/**
 * Finding things in a workspace by their words and by their meaning: its areas,
 * features and rules (in force, planned and past) and its proposals. It keeps its
 * own index, brought up to date whenever a proposal changes.
 */
export class Search_Module extends Module {

  static async initialize(base: Base, deps: Search_Deps, options: Search_Options) {
    const module = new Search_Module(base, new SearchEntry_Repository(base), deps, new Embedder(options))
    registerSearchRoutes(base, module)
    registerSearchWorkers(module, deps)
    return module
  }

  private readonly scheduled = new Map<string, Promise<void>>()
  private background = false

  private constructor(base: Base, private readonly repo: SearchEntry_Repository, private readonly deps: Search_Deps, private readonly embedder: Embedder) {
    super('search', base.transactions)
  }

  /** A page of what matches, best first, each saying where it belongs. */
  @UseCase('search.search')
  async search(workspaceId: string, input: SearchFilterDTO, page: PageRequest): Promise<SearchPageDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const filter = SearchFilterSchema.parse(input)
    if ((await this.repo.find({ workspaceId }, 1)).length === 0) await this.reindex(workspaceId)

    const layers: SearchLayer[] = ['in force', 'proposals', ...(filter.definition === 'planned' ? ['planned' as const] : []), ...(filter.history ? ['history' as const] : [])]
    const candidates = (await this.repo.find({ workspaceId, layers, kinds: filter.kinds }))
      .filter(entry => !filter.featureId || entry.toDTO().data.featureId === filter.featureId)
      .filter(entry => this.appliesIn(entry.toDTO().data.scope, filter.appliesIn))
    const byId = new Map(candidates.map(entry => [entry.id, entry]))

    // Each way of searching ranks what it finds; a result scores by both ranks.
    const scores = new Map<string, number>()
    const rank = (ids: string[]) => ids.filter(id => byId.has(id)).forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index)))
    const words = wordsQuery(filter.query)
    if (words) rank(await this.repo.match(workspaceId, words.match, CANDIDATES))
    const semantic = await this.semanticStatus(candidates)
    // Vectors missing and nobody computing them: written from outside the server, such as by the seed.
    if (semantic === 'loading' && !this.scheduled.has(workspaceId)) this.scheduleReindex(workspaceId)
    const [vector] = semantic === 'unavailable' ? [] : ((await this.embedder.embed([filter.query], 'query').catch(() => null)) ?? [])
    if (vector) rank(this.closest(vector, candidates))

    // A proposal shows once, by its part that matched best.
    const best = new Map<string, { entry: SearchEntry, score: number }>()
    for (const [id, score] of scores) {
      const entry = byId.get(id)!
      const dto = entry.toDTO()
      const group = dto.kind === 'proposal' ? `proposal|${dto.targetId}|${dto.layer}` : entry.slot
      if ((best.get(group)?.score ?? -1) < score) best.set(group, { entry, score })
    }
    const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).map(({ entry }) => entry)
    return this.results(workspaceId, ranked, page, words?.stems ?? [], semantic)
  }

  /** A page of what talks about the same as an artifact in force, closest first; never the artifact itself. */
  @UseCase('search.similar')
  async similar(workspaceId: string, targetId: string, page: PageRequest): Promise<SearchPageDTO> {
    await this.deps.workspaceMember.assertActive(workspaceId)
    const [source] = await this.repo.find({ workspaceId, targetId, layers: ['in force'] })
    const candidates = (await this.repo.find({ workspaceId, layers: ['in force'], kinds: ['feature', 'rule'] })).filter(entry => entry.toDTO().targetId !== targetId)
    const semantic = await this.semanticStatus(candidates)
    const vector = source?.toDTO().vector
    if (!vector || source?.toDTO().model !== this.embedder.model) return { items: [], hasMore: false, total: 0, semantic: semantic === 'ready' ? 'loading' : semantic }
    const byId = new Map(candidates.map(entry => [entry.id, entry]))
    return this.results(workspaceId, this.closest(vector, candidates, MIN_SIMILARITY).map(id => byId.get(id)!), page, [], semantic)
  }

  /**
   * Brings the workspace's index up to date with what it should hold: what changed
   * is rewritten (and its vector computed again later), what is gone, removed.
   */
  @UseCase('search.reindex')
  async reindex(workspaceId: string): Promise<void> {
    const drafts = await this.drafts(workspaceId)
    const existing = new Map((await this.repo.find({ workspaceId })).map(entry => [entry.slot, entry]))
    for (const draft of drafts) {
      const slot = SearchEntry.slotOf(draft)
      const entry = existing.get(slot)
      existing.delete(slot)
      if (!entry) await this.repo.persist(SearchEntry.create(workspaceId, draft))
      else if (entry.contentHash !== SearchEntry.hashOf(draft)) {
        entry.rewrite(draft)
        await this.repo.persist(entry)
      }
    }
    if (existing.size) await this.repo.delete({ workspaceId, id: [...existing.values()].map(entry => entry.id) })
  }

  /** Entries whose vector is still to compute with the current model. */
  @UseCase('search.missingVectors')
  async missingVectors(workspaceId: string, size: number): Promise<{ id: string, contentHash: string, text: string }[]> {
    return (await this.repo.find({ workspaceId, missingVectorOf: this.embedder.model }, size)).map(entry => ({ id: entry.id, contentHash: entry.contentHash, text: entry.text }))
  }

  /** Keeps the vectors computed, unless their entry changed meanwhile. */
  @UseCase('search.storeVectors')
  async storeVectors(workspaceId: string, vectors: { id: string, contentHash: string, vector: Float32Array }[]): Promise<void> {
    const entries = new Map((await this.repo.find({ workspaceId, id: vectors.map(each => each.id) })).map(entry => [entry.id, entry]))
    for (const { id, contentHash, vector } of vectors) {
      const entry = entries.get(id)
      if (!entry || entry.contentHash !== contentHash) continue
      entry.embedded(vector, this.embedder.model)
      await this.repo.persist(entry)
    }
  }

  /** For the workers: every workspace with an index. */
  @UseCase('search.indexedWorkspaces')
  async indexedWorkspaces(): Promise<string[]> {
    return this.repo.workspaceIds()
  }

  /**
   * Starts indexing in the background: the server does, scripts do not. Brings every
   * index up to date, in case something changed while the server was down.
   */
  async startBackground(): Promise<void> {
    this.background = true
    this.embedder.start()
    for (const workspaceId of await this.indexedWorkspaces()) this.scheduleReindex(workspaceId)
  }

  /**
   * Brings the index up to date and then computes the vectors that are missing, in
   * the background and one workspace at a time; asked again meanwhile, it runs once
   * more after.
   */
  scheduleReindex(workspaceId: string): void {
    if (!this.background) return
    const previous = this.scheduled.get(workspaceId) ?? Promise.resolve()
    const next = previous.then(async () => {
      await this.reindex(workspaceId)
      await this.computeVectors(workspaceId)
    }).catch(error => console.error(`Indexing workspace ${workspaceId} failed`, error))
    this.scheduled.set(workspaceId, next)
    void next.then(() => this.scheduled.get(workspaceId) === next && this.scheduled.delete(workspaceId))
  }

  private async computeVectors(workspaceId: string): Promise<void> {
    for (;;) {
      if (this.embedder.status === 'unavailable') return
      if (this.embedder.status === 'loading') {
        await Bun.sleep(2000)
        continue
      }
      const missing = await this.missingVectors(workspaceId, BATCH)
      if (missing.length === 0) return
      const vectors = await this.embedder.embed(missing.map(each => each.text), 'document')
      if (!vectors) continue
      await this.storeVectors(workspaceId, missing.map((each, index) => ({ id: each.id, contentHash: each.contentHash, vector: vectors[index]! })))
    }
  }

  /** Whether meaning can be used: the model is ready and every candidate has its vector. */
  private async semanticStatus(candidates: SearchEntry[]): Promise<SearchPageDTO['semantic']> {
    const status = this.embedder.status
    if (status !== 'ready') return status
    return candidates.every(entry => entry.toDTO().model === this.embedder.model) ? 'ready' : 'loading'
  }

  /** The ids of the candidates close enough to a vector, closest first. */
  private closest(vector: Float32Array, candidates: SearchEntry[], min = MIN_CLOSENESS): string[] {
    return candidates
      .flatMap(entry => {
        const dto = entry.toDTO()
        return dto.vector && dto.model === this.embedder.model ? [{ id: entry.id, score: closeness(vector, dto.vector) }] : []
      })
      .filter(({ score }) => score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, CANDIDATES)
      .map(({ id }) => id)
  }

  /** A rule's scope against the values asked for: a dimension it does not name applies in all its values. */
  private appliesIn(scope: RuleScopeDTO | null, values: { dimensionId: string, valueId: string }[]): boolean {
    if (!scope) return true
    return values.every(({ dimensionId, valueId }) => {
      const named = scope.find(each => each.dimensionId === dimensionId)
      return !named || named.valueIds.includes(valueId)
    })
  }

  /** A page of ranked entries as results, with names as they are now. */
  private async results(workspaceId: string, ranked: SearchEntry[], page: PageRequest, stems: string[], semantic: SearchPageDTO['semantic']): Promise<SearchPageDTO> {
    const start = page.cursor ? ranked.findIndex(entry => entry.id === page.cursor) + 1 : 0
    const slice = ranked.slice(start, start + page.size).map(entry => entry.toDTO())
    const featureIds = [...new Set(slice.map(dto => dto.data.featureId).filter(id => id !== null))]
    const features = new Map((featureIds.length ? await this.deps.feature.find(workspaceId, { id: featureIds }) : []).map(feature => [feature.id, feature.name]))
    const dimensions = slice.some(dto => dto.data.scope) ? await this.deps.dimension.list(workspaceId) : []

    const items: SearchResultDTO[] = slice.map(dto => ({
      id: dto.id,
      kind: dto.kind,
      layer: dto.layer,
      status: dto.data.status,
      targetId: dto.targetId,
      key: dto.data.key,
      label: dto.data.label,
      // What the title does not say already.
      snippet: snippetOf(dto.text.startsWith(dto.data.label) ? dto.text.slice(dto.data.label.length) : dto.text, stems),
      feature: dto.data.featureId && features.has(dto.data.featureId) ? { id: dto.data.featureId, name: features.get(dto.data.featureId)! } : null,
      scope: dto.data.scope && dto.data.scope.map(({ dimensionId, valueIds }) => {
        const dimension = dimensions.find(each => each.id === dimensionId)
        return { dimension: dimension?.name ?? '', values: valueIds.map(id => dimension?.values.find(value => value.id === id)?.name ?? '') }
      }),
      proposal: dto.data.proposal,
      version: dto.data.version,
      currentVersion: dto.data.currentVersion,
    }))
    return { items, hasMore: start + page.size < ranked.length, total: ranked.length, semantic }
  }

  /** Everything the workspace's index should hold, as it is now. */
  private async drafts(workspaceId: string): Promise<SearchEntryDraft[]> {
    const [areas, features, rules, proposals] = await Promise.all([
      this.deps.featureArea.find(workspaceId, {}),
      this.deps.feature.find(workspaceId, {}),
      this.deps.rule.find(workspaceId, {}),
      this.deps.proposal.find(workspaceId, {}),
    ])
    const drafts: SearchEntryDraft[] = []

    for (const area of areas) {
      drafts.push({ kind: 'feature-area', targetId: area.id, layer: area.retiredAt ? 'history' : 'in force', part: '', text: `${area.name}\n${area.description}`, data: { ...nothing, label: area.name, status: area.retiredAt ? 'retired' : 'in force' } })
    }
    for (const feature of features) {
      drafts.push({ kind: 'feature', targetId: feature.id, layer: feature.retiredAt ? 'history' : 'in force', part: '', text: `${feature.name}\n${feature.description}`, data: { ...nothing, label: feature.name, status: feature.retiredAt ? 'retired' : 'in force', featureId: feature.id } })
    }
    const current = new Map(rules.map(rule => [rule.id, rule]))
    for (const rule of rules) {
      drafts.push({
        kind: 'rule', targetId: rule.id, layer: rule.retiredAt ? 'history' : 'in force', part: '', text: ruleText(rule.current),
        data: { ...nothing, label: rule.current.statement, key: rule.key, status: rule.retiredAt ? 'retired' : 'in force', featureId: rule.featureId, scope: rule.current.scope, version: rule.current.version, currentVersion: rule.current.version },
      })
    }
    for (const version of await this.deps.rule.findVersions(workspaceId, rules.map(rule => rule.id))) {
      const rule = current.get(version.ruleId)!
      if (version.version === rule.current.version) continue
      drafts.push({
        kind: 'rule', targetId: rule.id, layer: 'history', part: `v${version.version}`, text: ruleText(version),
        data: { ...nothing, label: version.statement, key: rule.key, status: 'superseded', featureId: rule.featureId, scope: version.scope, version: version.version, currentVersion: rule.current.version },
      })
    }
    for (const proposal of proposals) {
      const layer = proposal.status === 'discarded' ? 'history' : 'proposals'
      const sections = sectionsOf(proposal.document)
      ;(sections.length ? sections : ['']).forEach((section, index) => drafts.push({
        kind: 'proposal', targetId: proposal.id, layer, part: `s${index}`, text: index === 0 ? `${proposal.title}\n${section}`.trim() : section,
        data: { ...nothing, label: proposal.title, key: proposal.key, status: proposal.status },
      }))
    }
    drafts.push(...(await this.planned(workspaceId, proposals.filter(proposal => proposal.status === 'accepted'))))
    return drafts
  }

  /** What the accepted proposals will leave each area, feature and rule they change. */
  private async planned(workspaceId: string, accepted: { id: string, key: string, title: string }[]): Promise<SearchEntryDraft[]> {
    if (accepted.length === 0) return []
    const proposals = new Map(accepted.map(proposal => [proposal.id, { key: proposal.key, title: proposal.title }]))
    const deltas: DeltaDTO[] = []
    for (let cursor: string | undefined, more = true; more;) {
      const page = await this.deps.delta.list(workspaceId, { proposalId: [...proposals.keys()] }, 'published', { size: 100, cursor })
      deltas.push(...page.items)
      cursor = page.items.at(-1)?.id
      more = page.hasMore
    }
    const STATUS = { create: 'planned: new', change: 'planned: changed', retire: 'planned: retired', restore: 'planned: restored' }
    return deltas.filter(delta => delta.kind !== 'dimension').map((delta): SearchEntryDraft => {
      const state = (delta.after ?? delta.before ?? {}) as Record<string, unknown>
      const before = (delta.before ?? {}) as Record<string, unknown>
      const data = { ...nothing, status: STATUS[delta.operation], proposal: proposals.get(delta.proposalId)! }
      if (delta.kind === 'rule') {
        const rule = state as { statement: string, why: string, criteria?: [], scope?: RuleScopeDTO, featureId?: string }
        const current = before as { key?: string, featureId?: string, current?: { statement: string, why: string, scope: RuleScopeDTO } }
        const shown = rule.statement ? rule : { ...current.current!, criteria: [] }
        return { kind: 'rule', targetId: delta.targetId, layer: 'planned', part: delta.id, text: ruleText(shown), data: { ...data, label: shown.statement, key: current.key ?? null, featureId: rule.featureId ?? current.featureId ?? null, scope: shown.scope ?? [] } }
      }
      const named = state as { name: string, description?: string }
      return { kind: delta.kind as 'feature-area' | 'feature', targetId: delta.targetId, layer: 'planned', part: delta.id, text: `${named.name}\n${named.description ?? ''}`, data: { ...data, label: named.name, featureId: delta.kind === 'feature' ? delta.targetId : null } }
    })
  }
}
