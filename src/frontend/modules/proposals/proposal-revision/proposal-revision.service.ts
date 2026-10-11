import { diffLines } from 'diff'
import { ApiError } from '@newt/api/core/api-error'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { ProposalApi, type DeltaSnapshotDTO, type ProposalRevisionDTO } from '@newt/api/proposal'
import type { TextDiffPart } from '@newt/ui/components/text-diff'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'

type RevisionState = {
  workspaceId: string
  key: string
  number: number
  /** Undefined while loading; null if there is no such revision. */
  revision: ProposalRevisionDTO | null | undefined
  /** Its document against the revision before it. */
  documentDiff: TextDiffPart[]
  dimensions: DimensionDTO[]
}

/** One revision: who published it and why, and what it changed in the document and the deltas. */
export class ProposalRevisionService {

  private readonly api = inject(ProposalApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly artifactNames = inject(ArtifactNamesService)
  private readonly store = new Store<RevisionState>({ workspaceId: '', key: '', number: 0, revision: undefined, documentDiff: [], dimensions: [] })

  readonly revision = this.store.select('revision')
  readonly documentDiff = this.store.select('documentDiff')
  readonly dimensions = this.store.select('dimensions')
  readonly names = this.artifactNames.names

  readonly deltas = new ListStore<DeltaSnapshotDTO & { id: string }>(async page => {
    const { workspaceId, key, number } = this.store.value
    const snapshots = await this.api.revisionDeltas(workspaceId, key, number, page)
    await this.artifactNames.resolve(workspaceId, snapshots.items.flatMap(each => [each.content, each.previous]
      .filter(content => content !== null)
      .map(content => ({ kind: each.kind, operation: each.operation, targetId: each.targetId, ...content! }))))
    return { ...snapshots, items: snapshots.items.map(each => ({ ...each, id: each.deltaId })) }
  })

  async load(workspaceId: string, key: string, number: number): Promise<void> {
    this.store.patch({ workspaceId, key, number, revision: undefined, documentDiff: [] })
    try {
      const [revision, previous, dimensions] = await Promise.all([
        this.api.revision(workspaceId, key, number),
        number > 1 ? this.api.revision(workspaceId, key, number - 1) : Promise.resolve(null),
        this.dimensionApi.list(workspaceId),
      ])
      this.store.patch({ revision, dimensions, documentDiff: diffLines(previous?.document ?? '', revision.document) })
      await this.deltas.loadFirstPage()
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.store.patch({ revision: null })
      else throw error
    }
  }

  name(id: string): string {
    return this.artifactNames.name(id)
  }
}
