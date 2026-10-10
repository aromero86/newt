import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ApiError } from '@newt/api/core/api-error'
import { FormStore } from './form-store'

const schema = z.object({ nick: z.string().min(2, 'Too short'), email: z.email('Not an email') })

const form = () => new FormStore(schema, { nick: '', email: '' }, { errorFields: { 'user.nick_taken': 'nick' } })

describe('FormStore', () => {
  test('a field follows what is typed into it', () => {
    const signup = form()
    const nick = signup.value('nick')

    signup.set('nick', 'lucia')

    expect(nick.value).toBe('lucia')
    expect(signup.value('nick')).toBe(nick)
  })

  test('invalid values become field errors and nothing is sent', async () => {
    const signup = form()
    let sent = false

    expect(await signup.submit(async () => { sent = true })).toBe(false)

    expect(sent).toBe(false)
    expect(signup.error('nick').value).toBe('Too short')
    expect(signup.error('email').value).toBe('Not an email')
  })

  test('typing in a field clears its error', async () => {
    const signup = form()
    await signup.submit(async () => {})

    signup.set('nick', 'lucia')

    expect(signup.error('nick').value).toBeUndefined()
    expect(signup.error('email').value).toBe('Not an email')
  })

  test('sends the parsed values', async () => {
    const signup = form()
    signup.set('nick', 'lucia')
    signup.set('email', 'lucia@acme.dev')
    let sent: unknown

    expect(await signup.submit(async data => { sent = data })).toBe(true)
    expect(sent).toEqual({ nick: 'lucia', email: 'lucia@acme.dev' })
  })

  test('a backend error that belongs to a field lands on it', async () => {
    const signup = form()
    signup.set('nick', 'lucia')
    signup.set('email', 'lucia@acme.dev')

    await signup.submit(async () => { throw new ApiError(409, 'The nick @lucia is already taken', 'user.nick_taken') })

    expect(signup.error('nick').value).toBe('The nick @lucia is already taken')
    expect(signup.failure.value).toBeNull()
  })

  test('any other failure belongs to the form', async () => {
    const signup = form()
    signup.set('nick', 'lucia')
    signup.set('email', 'lucia@acme.dev')

    await signup.submit(async () => { throw new ApiError(500, 'Something went wrong', 'internal') })

    expect(signup.failure.value).toBe('Something went wrong')
    expect(signup.submitting.value).toBe(false)
  })
})
