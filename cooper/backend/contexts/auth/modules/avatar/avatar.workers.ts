import type { Avatar_Module } from './avatar.module'

/** What pictures do when something happens: each a job saved with it, safe to run again. */
export function registerAvatarWorkers(avatars: Avatar_Module): void {
  avatars.events.ready.subscribe(({ userId, id }) => avatars.removeOlder(userId, id), {
    strategy: 'handler',
    queue: 'avatar.removeOlder.on.avatar.ready',
  })
  avatars.events.removed.subscribe(({ id }) => avatars.removeBytes(id), {
    strategy: 'handler',
    queue: 'avatar.removeBytes.on.avatar.removed',
  })
  avatars.hourly.subscribe(() => avatars.sweepPending(), {
    strategy: 'handler',
    queue: 'avatar.sweepPending.on.avatar.hourly',
  })
}
