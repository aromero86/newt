import { describe, expect, test } from 'bun:test'
import type { ApplicationDescription } from '../../api/structure'
import { differenceOf, findModule, matches, moduleHref, moduleOfEvent, reactionsOf, writtenModuleId } from './app-structure'

const module = (context: string, name: string, useCases: string[], events: string[] = []) => ({
  id: `${context}/${name}`, context, name, className: `${name}_Module`, deps: [],
  useCases: useCases.map(useCase => ({ id: `${context}/${name}.${useCase}`, name: `${name}.${useCase}`, writesTo: [], retryOnConflict: true })),
  events: events.map(event => ({ id: `${context}/${name}.${event}`, name: `${name}.${event}`, schedule: null })),
})

// Two contexts with a module named alike, as cooper's boards and backoffice have `workspace`.
const description: ApplicationDescription = {
  version: 1,
  contexts: [
    {
      name: 'auth', uses: [], modules: [module('auth', 'tenant', ['create'], ['deleted'])],
      subscriptions: [{ event: 'auth/tenant.deleted', strategy: 'handler', queue: 'workspace.purge.on.tenant.deleted', handler: 'workspace.purge', attempts: null, filtered: false }],
    },
    { name: 'boards', uses: ['auth'], modules: [module('boards', 'workspace', ['purge'])], subscriptions: [] },
    { name: 'backoffice', uses: ['auth'], modules: [module('backoffice', 'workspace', ['list'])], subscriptions: [] },
  ],
}

describe('reading a description', () => {
  test('finds a handler\'s module by its use case, though two modules share its name', () => {
    const [reaction] = reactionsOf(description)
    expect(reaction).toMatchObject({ context: 'auth', handler: 'workspace.purge' })
    expect(reaction!.handlerModule?.id).toBe('boards/workspace')
  })

  test('finds a module, the one that tells an event, and their addresses', () => {
    expect(findModule(description, 'backoffice', 'workspace')?.id).toBe('backoffice/workspace')
    expect(moduleOfEvent(description, 'auth/tenant.deleted')?.id).toBe('auth/tenant')
    expect(moduleHref('a1', 'boards/workspace')).toBe('/apps/a1/contexts/boards/modules/workspace')
    expect(writtenModuleId('auth', 'access')).toBe('auth/access')
  })

  test('matches a filter by every word, anywhere, whatever the case', () => {
    expect(matches('card.notifyAssignee', 'card NOTIFY')).toBe(true)
    expect(matches('card.notifyAssignee', 'card purge')).toBe(false)
    expect(matches('anything', '')).toBe(true)
  })

  test('tells what a version added and what it took away', () => {
    const after: ApplicationDescription = {
      ...description,
      contexts: [
        { ...description.contexts[0]!, modules: [module('auth', 'tenant', ['create', 'rename'], ['deleted'])] },
        description.contexts[1]!,
      ],
    }

    const { added, removed } = differenceOf(description, after)
    expect(added.map(part => part.id)).toEqual(['auth/tenant.rename'])
    expect(removed.map(part => `${part.kind} ${part.id}`)).toEqual(['context backoffice', 'module backoffice/workspace', 'useCase backoffice/workspace.list'])
    expect(differenceOf(null, after).removed).toEqual([])
  })
})
