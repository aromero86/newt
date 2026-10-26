import type { Access_Module } from '../../../auth/modules/access/access.module'
import type { User_Module as AuthUser_Module } from '../../../auth/modules/user/user.module'

/** auth's modules, called through their use cases: auth keeps who the staff are. */
export interface Staff_Deps {
  /** The accounts: who someone of the staff is, and whose an email is. */
  user: AuthUser_Module
  /** Who may enter the backoffice, asked every time; and giving or taking that away. */
  access: Access_Module
}
