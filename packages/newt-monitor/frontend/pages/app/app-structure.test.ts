import { describe, expect, test } from 'bun:test'
import type { ApplicationDescription } from '../../api/structure'
import { contextModulesGraph, contextsGraph, differenceOf, findModule, matches, moduleHref, moduleNeighbourhood, moduleOfEvent, reactionsOf, writtenModuleId } from './app-structure'

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

  test('draws its contexts, a context\'s modules with those of others it uses, and a module\'s neighbourhood', () => {
    // boards' workspace uses auth's tenant as a dep, and handles its tenant.deleted.
    const withDeps: ApplicationDescription = {
      ...description,
      contexts: description.contexts.map(context => context.name !== 'boards' ? context : {
        ...context,
        modules: [{ ...context.modules[0]!, deps: [{ name: 'auth.tenant', kind: 'module', target: 'auth/tenant' }] }, module('boards', 'board', ['create'])],
      }),
    }
    expect(contextsGraph('a1', withDeps).edges).toEqual([{ from: 'boards', to: 'auth' }, { from: 'backoffice', to: 'auth' }])

    const boards = contextModulesGraph('a1', withDeps, 'boards', false)
    // board has nothing to do with another context: it is left out.
    // Another context is one box: which of its modules shows on a module's neighbourhood.
    expect(boards.nodes.map(node => [node.id, node.group, node.column])).toEqual([['auth', undefined, 0], ['boards/workspace', 'boards', 1]])
    expect(boards.edges).toEqual([{ from: 'boards/workspace', to: 'auth' }])
    const auth = contextModulesGraph('a1', withDeps, 'auth', false)
    expect(auth.nodes.map(node => [node.id, node.column])).toEqual([['auth/tenant', 1], ['boards', 2]])
    expect(auth.edges).toEqual([{ from: 'boards', to: 'auth/tenant' }])

    const tenant = moduleNeighbourhood('a1', withDeps, 'auth/tenant', true)
    expect(tenant.nodes.find(node => node.emphasis)?.id).toBe('auth/tenant')
    // A dep and a reaction to the same module are one edge, solid.
    expect(tenant.edges).toEqual([{ from: 'boards/workspace', to: 'auth/tenant' }])
  })
})
