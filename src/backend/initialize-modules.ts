import type { Base } from './base/base'
import { config } from './config'
import { AuthCredential_Module } from './modules/auth-credential/auth-credential.module'
import { Dimension_Module } from './modules/dimension/dimension.module'
import { FeatureArea_Module } from './modules/feature-area/feature-area.module'
import { Feature_Module } from './modules/feature/feature.module'
import { Rule_Module } from './modules/rule/rule.module'
import { Health_Module } from './modules/health/health.module'
import { Mail_Module } from './modules/mail/mail.module'
import { AuthPasswordReset_Module } from './modules/auth-password-reset/auth-password-reset.module'
import { AuthSession_Module } from './modules/auth-session/auth-session.module'
import { User_Module } from './modules/user/user.module'
import { WorkspaceInvitation_Module } from './modules/workspace-invitation/workspace-invitation.module'
import { WorkspaceMember_Module } from './modules/workspace-member/workspace-member.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

/** Every module, in dependency order: each one after every module it depends on. */
export async function initializeModules(base: Base) {
  await Health_Module.initialize(base)
  const user = await User_Module.initialize(base)
  const authCredential = await AuthCredential_Module.initialize(base)
  const authSession = await AuthSession_Module.initialize(base, { user, authCredential }, { days: config.sessionDays })
  const mail = await Mail_Module.initialize(base, config.mail)
  const workspaceMember = await WorkspaceMember_Module.initialize(base, { user })
  const workspace = await Workspace_Module.initialize(base, { workspaceMember })
  const dimension = await Dimension_Module.initialize(base, { workspace, workspaceMember })
  const featureArea = await FeatureArea_Module.initialize(base, { workspace, workspaceMember })
  const feature = await Feature_Module.initialize(base, { featureArea, workspace, workspaceMember })
  const rule = await Rule_Module.initialize(base, { dimension, feature, workspace, workspaceMember })
  await WorkspaceInvitation_Module.initialize(base, { user, workspace, workspaceMember, mail }, { days: config.invitationDays, publicUrl: config.publicUrl })
  await AuthPasswordReset_Module.initialize(base, { user, authCredential, mail }, { minutes: config.passwordResetMinutes, publicUrl: config.publicUrl })
  return { user, authCredential, authSession, mail, workspaceMember, workspace, dimension, featureArea, feature, rule }
}
