import type { AuthCredential_Module } from '../auth-credential/auth-credential.module'
import type { Mail_Module } from '../mail/mail.module'
import type { User_Module } from '../user/user.module'

export interface AuthPasswordReset_Deps {
  user: User_Module
  authCredential: AuthCredential_Module
  mail: Mail_Module
}
