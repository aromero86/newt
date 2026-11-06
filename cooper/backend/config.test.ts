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

  test('in production, files on disk need a secret of their own, which files on S3 do not', () => {
    const secrets = {
      NODE_ENV: 'production',
      COOPER_BOARDS_CLIENT_SECRET: 'a boards secret of thirty-two characters',
      COOPER_BACKOFFICE_CLIENT_SECRET: 'a backoffice secret of thirty-two characters',
    }
    const s3 = {
      COOPER_S3_ENDPOINT: 'https://s3.eu-west-1.amazonaws.com',
      COOPER_S3_ACCESS_KEY_ID: 'key',
      COOPER_S3_SECRET_ACCESS_KEY: 'secret',
      COOPER_S3_PRIVATE_BUCKET: 'cooper-private',
      COOPER_S3_PUBLIC_BUCKET: 'cooper-public',
      COOPER_S3_PUBLIC_URL: 'https://files.cooper.test',
    }

    expect(() => readConfig(secrets)).toThrow(/COOPER_FILES_SECRET/)
    expect(() => readConfig({ ...secrets, COOPER_FILES_SECRET: 'too short' })).toThrow(/COOPER_FILES_SECRET/)
    expect(readConfig({ ...secrets, ...s3 }).boards.files.s3?.privateBucket).toBe('cooper-private')
  })

  test('S3 says all of what it needs, or nothing starts', () => {
    expect(() => readConfig({ COOPER_S3_ENDPOINT: 'https://s3.example.com' }))
      .toThrow(/COOPER_S3_ACCESS_KEY_ID[\s\S]*COOPER_S3_PUBLIC_URL/)
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
      COOPER_FILES_SECRET: 'a secret for files of thirty-two characters',
    })
    expect(config.auth.clientSecrets).toEqual({
      cooper: 'a boards secret of thirty-two characters',
      backoffice: 'a backoffice secret of thirty-two characters',
    })
  })
})
