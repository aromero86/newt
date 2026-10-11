import { ProposalApi, type ProposalDTO, type ProposalStatus } from '@newt/api/proposal'
import { z } from 'zod'
import { FormStore } from '../../../core/form/form-store'
import { inject } from '../../../core/injector/inject'
import { ListStore } from '../../../core/list/list-store'
import { Store } from '../../../core/store/store'

/** The groups the list shows, each a set of states. */
export const PROPOSAL_VIEWS = {
  open: { label: 'Open', status: ['draft', 'in review'] },
  accepted: { label: 'Accepted', status: ['accepted'] },
  merged: { label: 'Merged', status: ['merged'] },
  discarded: { label: 'Discarded', status: ['discarded'] },
  all: { label: 'All', status: [] },
} satisfies Record<string, { label: string, status: ProposalStatus[] }>

export type ProposalView = keyof typeof PROPOSAL_VIEWS

const CreateSchema = z.object({ title: z.string().trim().min(1, 'Give it a title').max(120, 'Keep it under 120 characters') })

/** A workspace's proposals, page by page, by state. */
export class ProposalsListService {

  private readonly api = inject(ProposalApi)
  private readonly store = new Store<{ workspaceId: string, view: ProposalView, counts: Partial<Record<ProposalView, number>>, creating: boolean }>({ workspaceId: '', view: 'open', counts: {}, creating: false })

  readonly view = this.store.select('view')
  /** How many proposals each view has, for the filters. */
  readonly counts = this.store.select('counts')
  readonly creating = this.store.select('creating')
  readonly proposals = new ListStore<ProposalDTO>(page => {
    const { workspaceId, view } = this.store.value
    return this.api.list(workspaceId, PROPOSAL_VIEWS[view].status, page)
  })

  readonly form = new FormStore(CreateSchema, { title: '' }, { errorFields: { 'workspace.archived': 'title', validation: 'title' } })

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId, view: 'open' })
    this.form.reset({ title: '' })
    await Promise.all([this.proposals.loadFirstPage(), this.loadCounts()])
  }

  openCreate(): void {
    this.form.reset({ title: '' })
    this.store.patch({ creating: true })
  }

  closeCreate(): void {
    this.store.patch({ creating: false })
  }

  private async loadCounts(): Promise<void> {
    const { workspaceId } = this.store.value
    const views = Object.keys(PROPOSAL_VIEWS) as ProposalView[]
    const totals = await Promise.all(views.map(view => this.api.list(workspaceId, PROPOSAL_VIEWS[view].status, { size: 1 }).then(page => page.total)))
    this.store.patch({ counts: Object.fromEntries(views.map((view, index) => [view, totals[index]])) })
  }

  async show(view: ProposalView): Promise<void> {
    this.store.patch({ view })
    await this.proposals.loadFirstPage()
  }

  /** Resolves to the new draft, if it was created. */
  async create(): Promise<ProposalDTO | undefined> {
    let created: ProposalDTO | undefined
    await this.form.submit(async ({ title }) => {
      created = await this.api.create(this.store.value.workspaceId, title)
    })
    return created
  }
}
