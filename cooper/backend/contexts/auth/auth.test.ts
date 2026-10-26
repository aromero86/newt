import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Auth_Context } from './auth.context'

let auth: Auth_Context

beforeEach(async () => {
  auth = await Auth_Context.open({ ...config.auth, database: ':memory:', port: 0 })
  auth.start()
})

afterEach(() => auth.stop())

const modules = () => auth.modules
const signUp = (name: string, email = `${name.toLowerCase()}@cooper.test`) => modules().user.signUp({ email, name, password: 'a long password' })

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
