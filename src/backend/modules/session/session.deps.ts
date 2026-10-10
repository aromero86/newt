import type { Credential_Module } from '../credential/credential.module'
import type { User_Module } from '../user/user.module'

export interface Session_Deps {
  user: User_Module
  credential: Credential_Module
}
