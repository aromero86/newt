import type { StaffGrantDTO, StaffMemberDTO } from '../../../backend/contexts/backoffice/modules/staff/staff.schema'
import type { Page } from '../core/page'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backoffice's `staff` module: who may use the backoffice. */
export class BackofficeStaffApi extends Requester {
  protected readonly path = '/staff'

  /** The staff, the oldest first. */
  list(page?: PageRequest) {
    return this.get<Page<StaffMemberDTO>>('', page)
  }

  /** Someone with an account becomes staff, by its email. */
  grant(input: StaffGrantDTO) {
    return this.post<StaffMemberDTO>('', input)
  }

  /** Someone leaves the staff; never oneself. */
  revoke(userId: string) {
    return this.delete<void>(`/${userId}`)
  }
}
