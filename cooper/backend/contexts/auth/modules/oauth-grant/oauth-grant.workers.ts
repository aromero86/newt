import type { OauthGrant_Module } from './oauth-grant.module'

/** Every night, the requests past their minutes go, but the redeemed: anyone may ask, and their rows would only pile up. */
export function registerOauthGrantWorkers(grants: OauthGrant_Module): void {
  grants.nightly.subscribe(() => grants.purgeExpired(), {
    strategy: 'handler',
    queue: 'oauthGrant.purgeExpired.on.oauthGrant.nightly',
  })
}
