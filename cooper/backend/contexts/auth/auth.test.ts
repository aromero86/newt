import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { runAsActor } from 'newt/core'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Auth_Context } from './auth.context'
import type { UserDTO } from './modules/user/user.schema'

let auth: Auth_Context

beforeEach(async () => {
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port: 0 })
  auth.start()
})

afterEach(() => auth.stop())

const modules = () => auth.modules
/** Until the background work is done: the jobs the commits wrote, run. */
const settled = () => auth.base.jobs.idle()
const signUp = (name: string, email = `${name.toLowerCase()}@cooper.test`) => modules().user.signUp({ email, name, password: 'a long password' })
const as = <T>(user: UserDTO, fn: () => Promise<T>) => runAsActor({ userId: user.id, via: 'web' }, fn)
const page = { size: 20 }

describe('accounts', () => {
  test('signs up with an email no other account has, whatever its case', async () => {
    const ana = await signUp('Ana', ' Ana@Cooper.Test ')
    expect(ana).toMatchObject({ email: 'ana@cooper.test', name: 'Ana' })
    expect(ana).not.toHaveProperty('passwordHash')

    await expect(signUp('Other Ana', 'ANA@cooper.test')).rejects.toMatchObject({ code: 'user.email_taken' })
    const atOnce = await Promise.allSettled([signUp('Bob', 'bob@cooper.test'), signUp('Bob', 'BOB@cooper.test')])
    expect(atOnce.map(each => each.status).sort()).toEqual(['fulfilled', 'rejected'])
  })

  test('checks a password, and says nothing about which emails have an account', async () => {
    await signUp('Ana')
    expect(await modules().user.verifyPassword('ANA@cooper.test', 'a long password')).toMatchObject({ name: 'Ana' })
    expect(await modules().user.verifyPassword('ana@cooper.test', 'wrong')).toBeNull()
    expect(await modules().user.verifyPassword('nobody@cooper.test', 'a long password')).toBeNull()
    await expect(modules().session.signIn({ email: 'nobody@cooper.test', password: 'x' })).rejects.toMatchObject({ code: 'session.invalid_credentials' })
  })

  test('opens a session at sign-up, unless the product takes no new accounts', async () => {
    const { user, token } = await modules().session.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password', productId: 'cooper' })
    expect(await modules().session.authenticate(token)).toEqual({ userId: user.id, via: 'web' })

    await expect(modules().session.signUp({ email: 'bob@cooper.test', name: 'Bob', password: 'a long password', productId: 'backoffice' })).rejects.toMatchObject({ code: 'session.sign_up_closed' })
    await modules().session.signOut(token)
    expect(await modules().session.authenticate(token)).toBeNull()
  })

  test('lists accounts newest first, with the filters it allows', async () => {
    await signUp('Ana')
    await signUp('Bob')
    const all = await modules().user.list(undefined, page)
    expect(all.items.map(user => user.name)).toEqual(['Bob', 'Ana'])
    const found = await modules().user.list({ field: 'email', op: 'ieq', value: 'BOB@cooper.test' }, page)
    expect(found.items.map(user => user.name)).toEqual(['Bob'])
    await expect(modules().user.list({ field: 'passwordHash', op: 'eq', value: 'x' }, page)).rejects.toMatchObject({ name: 'ZodError' })
  })

  test('signs up, in and out through its API, the session in a cookie only auth reads', async () => {
    const server = serve(auth.serving())
    try {
      const call = (method: string, path: string, body?: unknown, cookie = '') => fetch(new URL(`/api${path}`, server.url), {
        method,
        headers: { 'content-type': 'application/json', cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const signedUp = await call('POST', '/session/sign-up', { email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })
      expect(signedUp.status).toBe(201)
      expect(signedUp.headers.get('set-cookie')).toContain('HttpOnly')
      const cookie = signedUp.headers.get('set-cookie')!.split(';')[0]!
      expect(await (await call('GET', '/session', undefined, cookie)).json()).toMatchObject({ name: 'Ana', email: 'ana@cooper.test' })
      expect((await call('GET', '/session')).status).toBe(401)

      expect((await call('POST', '/session/sign-in', { email: 'ana@cooper.test', password: 'wrong' })).status).toBe(401)
      expect((await call('POST', '/session/sign-out', undefined, cookie)).status).toBe(204)
      expect((await call('GET', '/session', undefined, cookie)).status).toBe(401)
    } finally {
      await server.stop()
    }
  })
})

describe('workspaces', () => {
  test('makes its creator its admin at once, and lists each one\'s workspaces', async () => {
    const ana = await signUp('Ana')
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

    expect(await modules().access.check(ana.id, 'cooper', acme.id)).toMatchObject({ role: 'admin' })
    expect((await modules().tenant.listForUser(ana.id, page)).items.map(tenant => tenant.name)).toEqual(['Acme'])
    await settled()
    // Its worker found the admin there already: still one.
    expect((await modules().access.listForTenant(acme.id, page)).total).toBe(1)
  })

  test('is renamed and deleted by its admin only; whoever is not a member is told it does not exist', async () => {
    const [ana, bob, eve] = [await signUp('Ana'), await signUp('Bob'), await signUp('Eve')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await modules().access.admit({ userId: bob.id, productId: 'cooper', tenantId: acme.id, role: 'member' })

    await expect(as(bob, () => modules().tenant.rename(acme.id, { name: 'Bob Inc' }))).rejects.toMatchObject({ code: 'tenant.not_admin' })
    await expect(as(eve, () => modules().tenant.rename(acme.id, { name: 'Eve Inc' }))).rejects.toMatchObject({ code: 'tenant.not_found' })
    expect(await as(ana, () => modules().tenant.rename(acme.id, { name: 'Acme Corp' }))).toMatchObject({ name: 'Acme Corp' })
  })

  test('keeps one admin, who is never removed; a member may be removed or leave', async () => {
    const [ana, bob, cai] = [await signUp('Ana'), await signUp('Bob'), await signUp('Cai')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

    await expect(modules().access.admit({ userId: bob.id, productId: 'cooper', tenantId: acme.id, role: 'admin' })).rejects.toMatchObject({ code: 'access.tenant_has_admin' })
    await expect(as(ana, () => modules().access.revoke({ userId: ana.id, productId: 'cooper', tenantId: acme.id }))).rejects.toMatchObject({ code: 'access.admin_not_revocable' })

    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await as(ana, () => modules().access.grant({ userId: cai.id, productId: 'cooper', tenantId: acme.id }))
    await expect(as(bob, () => modules().access.revoke({ userId: cai.id, productId: 'cooper', tenantId: acme.id }))).rejects.toMatchObject({ code: 'access.not_admin' })
    await as(ana, () => modules().access.revoke({ userId: cai.id, productId: 'cooper', tenantId: acme.id }))
    await as(bob, () => modules().access.revoke({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    expect((await modules().access.listForTenant(acme.id, page)).items.map(access => access.userId)).toEqual([ana.id])
  })

  test('gives an access once, however many give it at the same time', async () => {
    const [ana, bob, staff] = [await signUp('Ana'), await signUp('Bob'), await signUp('Staff')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    const bobIn = { userId: bob.id, productId: 'cooper', tenantId: acme.id }
    await Promise.all([as(ana, () => modules().access.grant(bobIn)), as(ana, () => modules().access.grant(bobIn)), modules().access.admit({ ...bobIn, role: 'member' })])
    expect((await modules().access.listForTenant(acme.id, page)).total).toBe(2)

    const staffIn = { userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' as const }
    await Promise.all([modules().access.admit(staffIn), modules().access.admit(staffIn)])
    expect((await modules().access.listForProduct('backoffice', page)).total).toBe(1)
  })

  test('admits its admin again as a no-op, even at the same time as its worker', async () => {
    const ana = await signUp('Ana')
    // What the worker of `tenant.created` does, while the request still gives the admin.
    const workers: Promise<unknown>[] = []
    modules().tenant.events.created.subscribe(tenant => {
      workers.push(modules().access.admit({ userId: tenant.createdBy, productId: 'cooper', tenantId: tenant.id, role: 'admin' }))
    }, { strategy: 'fire-and-forget' })
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await Promise.all(workers)
    expect(workers).toHaveLength(1)
    expect((await modules().access.listForTenant(acme.id, page)).items).toMatchObject([{ userId: ana.id, role: 'admin' }])
  })

  test('only the staff give the staff access to the backoffice', async () => {
    const [staff, ana] = [await signUp('Staff'), await signUp('Ana')]
    await modules().access.admit({ userId: staff.id, productId: 'backoffice', tenantId: null, role: 'member' })

    await expect(as(ana, () => modules().access.grant({ userId: ana.id, productId: 'backoffice' }))).rejects.toMatchObject({ code: 'access.not_admin' })
    await as(staff, () => modules().access.grant({ userId: ana.id, productId: 'backoffice' }))
    expect(await modules().access.check(ana.id, 'backoffice')).toMatchObject({ tenantId: null })
    await expect(as(staff, () => modules().access.grant({ userId: ana.id, productId: 'nope' }))).rejects.toMatchObject({ code: 'reference_not_found' })
  })

  test('takes every access away once deleted, from its workers', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    const told: string[] = []
    modules().access.events.revoked.subscribe(access => { told.push(access.userId) }, { strategy: 'fire-and-forget' })

    await expect(as(bob, () => modules().tenant.delete(acme.id))).rejects.toMatchObject({ code: 'tenant.not_admin' })
    await as(ana, () => modules().tenant.delete(acme.id))
    await expect(modules().tenant.get(acme.id)).rejects.toMatchObject({ code: 'tenant.not_found' })
    await settled()

    expect((await modules().access.listForTenant(acme.id, page)).total).toBe(0)
    expect(told.sort()).toEqual([ana.id, bob.id].sort())
    expect((await modules().tenant.listForUser(ana.id, page)).items).toEqual([])
  })

  test('lets nobody in once deleted, before its workers run', async () => {
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await settled()
    await auth.base.jobs.stop()

    await as(ana, () => modules().tenant.delete(acme.id))
    expect(await modules().access.check(bob.id, 'cooper', acme.id)).toBeNull()
    expect(await modules().access.check(ana.id, 'cooper', acme.id)).toBeNull()
    expect((await modules().access.listForUser(bob.id, page, 'cooper')).total).toBe(0)
    expect((await modules().tenant.listForUser(ana.id, page)).total).toBe(0)
  })

  test('lists every workspace newest first, with the filters it allows', async () => {
    const ana = await signUp('Ana')
    await as(ana, () => modules().tenant.create({ name: 'Acme' }))
    await as(ana, () => modules().tenant.create({ name: 'Globex' }))
    expect((await modules().tenant.list(undefined, page)).items.map(tenant => tenant.name)).toEqual(['Globex', 'Acme'])
    expect((await modules().tenant.list({ field: 'name', op: 'ieq', value: 'ACME' }, page)).items.map(tenant => tenant.name)).toEqual(['Acme'])
  })
})
