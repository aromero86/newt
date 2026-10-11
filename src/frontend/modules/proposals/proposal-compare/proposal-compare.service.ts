import { diffLines } from 'diff'
import { DimensionApi, type DimensionDTO } from '@newt/api/dimension'
import { ProposalApi, type DeltaComparisonDTO } from '@newt/api/proposal'
import type { TextDiffPart } from '@newt/ui/components/text-diff'
import { toast } from '@newt/ui/components/toast'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'
import { ArtifactNamesService } from '../../../services/artifact-names/artifact-names.service'

type CompareState = {
  workspaceId: string
  key: string
  from: number
  to: number
  documentDiff: TextDiffPart[]
  dimensions: DimensionDTO[]
  loaded: boolean
}

/** Two revisions of a proposal side by side: the document and each delta. */
export class ProposalCompareService {

  private readonly api = inject(ProposalApi)
  private readonly dimensionApi = inject(DimensionApi)
  private readonly artifactNames = inject(ArtifactNamesService)
  private readonly store = new Store<CompareState>({ workspaceId: '', key: '', from: 0, to: 0, documentDiff: [], dimensions: [], loaded: false })

  readonly documentDiff = this.store.select('documentDiff')
  readonly dimensions = this.store.select('dimensions')
  readonly loaded = this.store.select('loaded')
  readonly names = this.artifactNames.names

  readonly deltas = new ListStore<DeltaComparisonDTO & { id: string }>(async page => {
    const { workspaceId, key, from, to } = this.store.value
    const compared = await this.api.compare(workspaceId, key, from, to, page)
    await this.artifactNames.resolve(workspaceId, compared.items.flatMap(each => [each.from, each.to]
      .filter(content => content !== null)
      .map(content => ({ kind: each.kind, operation: each.operation, targetId: each.targetId, ...content! }))))
    return { ...compared, items: compared.items.map(each => ({ ...each, id: each.deltaId })) }
  })

  async load(workspaceId: string, key: string, from: number, to: number): Promise<void> {
    this.store.patch({ workspaceId, key, from, to, loaded: false })
    try {
      const [a, b, dimensions] = await Promise.all([this.api.revision(workspaceId, key, from), this.api.revision(workspaceId, key, to), this.dimensionApi.list(workspaceId)])
      this.store.patch({ documentDiff: diffLines(a.document, b.document), dimensions })
      await this.deltas.loadFirstPage()
      this.store.patch({ loaded: true })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  name(id: string): string {
    return this.artifactNames.name(id)
  }
}
