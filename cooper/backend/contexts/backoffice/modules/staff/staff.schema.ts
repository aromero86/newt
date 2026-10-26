import { z } from 'zod'
import type { UserDTO } from '../../../auth/modules/user/user.schema'

/** Someone becomes staff by the email of their account, which they made in auth first. */
export const StaffGrantSchema = z.object({
  email: z.string().trim().pipe(z.email('Write a valid email').max(254, 'Use at most 254 characters')),
})

/**
 * Someone of the staff: their account, and since when they may enter the backoffice.
 * Its `id` is their access's, by which the list goes page after page.
 */
export type StaffMemberDTO = {
  id: string
  userId: string
  name: UserDTO['name']
  email: UserDTO['email']
  since: string
}

export type StaffGrantDTO = z.input<typeof StaffGrantSchema>
