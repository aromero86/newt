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
  private readonly store = new Store<{ workspaceId: string, view: ProposalView }>({ workspaceId: '', view: 'open' })

  readonly view = this.store.select('view')
  readonly proposals = new ListStore<ProposalDTO>(page => {
    const { workspaceId, view } = this.store.value
    return this.api.list(workspaceId, PROPOSAL_VIEWS[view].status, page)
  })

  readonly form = new FormStore(CreateSchema, { title: '' }, { errorFields: { 'workspace.archived': 'title', validation: 'title' } })

  async load(workspaceId: string): Promise<void> {
    this.store.patch({ workspaceId, view: 'open' })
    this.form.reset({ title: '' })
    await this.proposals.loadFirstPage()
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
