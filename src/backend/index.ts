import { Base } from './base/base'
import { serveFrontend } from './base/http/serve-frontend'
import { config } from './config'
import { AuthCredential_Module } from './modules/auth-credential/auth-credential.module'
import { Health_Module } from './modules/health/health.module'
import { Mail_Module } from './modules/mail/mail.module'
import { AuthPasswordReset_Module } from './modules/auth-password-reset/auth-password-reset.module'
import { AuthSession_Module } from './modules/auth-session/auth-session.module'
import { User_Module } from './modules/user/user.module'
import { WorkspaceInvitation_Module } from './modules/workspace-invitation/workspace-invitation.module'
import { WorkspaceMember_Module } from './modules/workspace-member/workspace-member.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

// Opening the base brings the database up to date before anything reads it.
const base = await Base.open(config)

// Modules in dependency order: each one after every module it depends on.
await Health_Module.initialize(base)
const user = await User_Module.initialize(base)
const authCredential = await AuthCredential_Module.initialize(base)
await AuthSession_Module.initialize(base, { user, authCredential }, { days: config.sessionDays })
const mail = await Mail_Module.initialize(base, config.mail)
const workspaceMember = await WorkspaceMember_Module.initialize(base, { user })
const workspace = await Workspace_Module.initialize(base, { workspaceMember })
await WorkspaceInvitation_Module.initialize(base, { user, workspace, workspaceMember, mail }, { days: config.invitationDays, publicUrl: config.publicUrl })
await AuthPasswordReset_Module.initialize(base, { user, authCredential, mail }, { minutes: config.passwordResetMinutes, publicUrl: config.publicUrl })

const server = Bun.serve({ port: config.port, routes: base.http.routes(), fetch: serveFrontend(config.frontendFolder) })
console.log(`Server listening on port ${config.port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()
    base.close()
    process.exit(0)
  })
}
