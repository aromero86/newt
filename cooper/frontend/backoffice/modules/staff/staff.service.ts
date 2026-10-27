import { BackofficeStaffApi, StaffGrantSchema, type StaffMemberDTO } from '@cooper/api/backoffice-staff'
import { FormStore, inject, ListStore } from 'newt-react'

/** Who may use the backoffice: listed, given access by email, and taken it away. */
export class StaffService {

  private readonly api = inject(BackofficeStaffApi)

  readonly list = new ListStore<StaffMemberDTO>(page => this.api.list(page))
  readonly form = new FormStore(StaffGrantSchema, { email: '' }, { errorFields: { 'staff.account_not_found': 'email' } })

  load(): Promise<void> {
    return this.list.loadFirstPage()
  }

  /** Resolves to whether they are staff now. Someone already in the list is not listed twice. */
  async grant(): Promise<boolean> {
    return this.form.submit(async input => {
      const member = await this.api.grant(input)
      if (!this.list.items.peek().some(each => each.id === member.id)) this.list.prepend(member)
      this.form.reset({ email: '' })
    })
  }

  /** Resolves to the error's message, or null once they left the staff. */
  async revoke(member: StaffMemberDTO): Promise<string | null> {
    try {
      await this.api.revoke(member.userId)
      this.list.remove(member.id)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Could not take the access away'
    }
  }
}
