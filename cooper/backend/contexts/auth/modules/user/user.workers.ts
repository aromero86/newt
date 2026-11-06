import type { User_Deps } from './user.deps'
import type { User_Module } from './user.module'

/** What the accounts do when something happens: a job saved with it, safe to run again. */
export function registerUserWorkers(users: User_Module, deps: User_Deps): void {
  deps.avatar.events.ready.subscribe(({ userId }) => users.refreshAvatar(userId), {
    strategy: 'handler',
    queue: 'user.refreshAvatar.on.avatar.ready',
  })
}
