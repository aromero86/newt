import { describe, expect, test } from 'bun:test'
import { readConfig } from './config'

describe('cooper\'s settings', () => {
  test('have what development needs by default', () => {
    const config = readConfig({})

    expect(config.auth.port).toBe(3001)
    expect(config.boards.publicUrl).toBe('http://localhost:3002')
    expect(config.auth.sessionDays).toBe(30)
    expect(config.boards.clientSecret).toBe('cooper-dev-boards-client-secret')
  })

  test('take an empty variable for none: an empty port is the default, not port 0', () => {
    expect(readConfig({ COOPER_AUTH_PORT: '', COOPER_MONITOR_PORT: '' }).auth.port).toBe(3001)
    expect(readConfig({ COOPER_MONITOR_PORT: '' }).monitor.port).toBe(3010)
  })

  test('stop it before it starts, naming every number that is wrong', () => {
    expect(() => readConfig({ COOPER_SESSION_DAYS: '30d', COOPER_BOARDS_PORT: '70000', COOPER_DRAIN_MS: '-1' }))
      .toThrow(/COOPER_SESSION_DAYS[\s\S]*COOPER_BOARDS_PORT[\s\S]*COOPER_DRAIN_MS/)
  })

  test('in production, require both OAuth client secrets, and refuse development\'s', () => {
    expect(() => readConfig({ NODE_ENV: 'production' }))
      .toThrow(/COOPER_BOARDS_CLIENT_SECRET[\s\S]*COOPER_BACKOFFICE_CLIENT_SECRET/)
    expect(() => readConfig({
      NODE_ENV: 'production',
      COOPER_BOARDS_CLIENT_SECRET: 'a boards secret of thirty-two characters',
      COOPER_BACKOFFICE_CLIENT_SECRET: 'cooper-dev-backoffice-client-secret',
    })).toThrow(/COOPER_BACKOFFICE_CLIENT_SECRET/)
    expect(() => readConfig({
      NODE_ENV: 'production',
      COOPER_BOARDS_CLIENT_SECRET: 'too short',
      COOPER_BACKOFFICE_CLIENT_SECRET: 'a backoffice secret of thirty-two characters',
    })).toThrow(/COOPER_BOARDS_CLIENT_SECRET/)

    const config = readConfig({
      NODE_ENV: 'production',
      COOPER_BOARDS_CLIENT_SECRET: 'a boards secret of thirty-two characters',
      COOPER_BACKOFFICE_CLIENT_SECRET: 'a backoffice secret of thirty-two characters',
    })
    expect(config.auth.clientSecrets).toEqual({
      cooper: 'a boards secret of thirty-two characters',
      backoffice: 'a backoffice secret of thirty-two characters',
    })
  })
})
