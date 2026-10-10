import type { AuthCredential_Module } from '../auth-credential/auth-credential.module'
import type { User_Module } from '../user/user.module'

export interface AuthSession_Deps {
  user: User_Module
  authCredential: AuthCredential_Module
}
