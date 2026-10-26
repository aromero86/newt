import { describe, expect, test } from 'bun:test'
import { TransactionScope } from './transaction-scope'

const steps = (log: string[]) => ({
  begin: () => { log.push('begin') },
  commit: () => { log.push('commit') },
  rollback: () => { log.push('rollback') },
  end: () => { log.push('end') },
})

describe('TransactionScope', () => {
  test('runs a transaction through its steps, and one inside it joins it', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    await scope.run(() => scope.run(() => { log.push('work') }, undefined, steps(log)), undefined, steps(log))

    expect(log).toEqual(['begin', 'work', 'commit', 'end'])
  })

  test('rolls back what throws, and ends it all the same', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    await expect(scope.run(() => { throw new Error('boom') }, undefined, steps(log))).rejects.toThrow('boom')

    expect(log).toEqual(['begin', 'rollback', 'end'])
  })

  test('runs a write that comes late, after the commit, in a transaction of its own', async () => {
    const scope = new TransactionScope()
    const log: string[] = []
    let late!: Promise<void>

    await scope.run(() => {
      // Left unawaited: it arrives while the transaction commits.
      late = new Promise<void>(resolve => setTimeout(() => resolve(scope.run(() => { log.push('late') }, undefined, steps(log))), 1))
    }, undefined, { ...steps(log), commit: async () => { await Bun.sleep(5); log.push('commit') } })
    await late

    expect(log).toEqual(['begin', 'commit', 'end', 'begin', 'late', 'commit', 'end'])
  })

  test('gives up waiting, saying why, instead of hanging on a transaction that waits for it', async () => {
    const scope = new TransactionScope(50)
    const detached = scope.run(async () => {
      // Code that lost the transaction (a snapshot taken outside it) asks for the store.
      await new Promise<void>((resolve, reject) => setTimeout(() => {
        scope.exclusive(() => {}).then(resolve, reject)
      }, 0))
    }, undefined, steps([]))

    await expect(detached).rejects.toThrow('waits for itself')
    expect(await scope.exclusive(() => 'free again')).toBe('free again')
  })
})

describe('afterCommit', () => {
  test('waits for the outermost commit, then runs each callback in order', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    await scope.run(async () => {
      scope.afterCommit(() => log.push('first'))
      await scope.run(() => scope.afterCommit(() => log.push('second')), undefined, steps(log))
      log.push('work done')
    }, undefined, steps(log))

    expect(log).toEqual(['begin', 'work done', 'commit', 'end', 'first', 'second'])
  })

  test('runs at once outside a transaction', () => {
    const scope = new TransactionScope()
    const log: string[] = []

    scope.afterCommit(() => log.push('now'))

    expect(log).toEqual(['now'])
  })

  test('never runs on a rollback', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    await scope.run(() => {
      scope.afterCommit(() => log.push('callback'))
      throw new Error('boom')
    }, undefined, steps(log)).catch(() => {})

    expect(log).toEqual(['begin', 'rollback', 'end'])
  })

  test('one that throws does not stop the others, nor undo the commit', async () => {
    const scope = new TransactionScope()
    const log: string[] = []
    const originalError = console.error
    console.error = () => {}

    try {
      await scope.run(() => {
        scope.afterCommit(() => { throw new Error('callback failed') })
        scope.afterCommit(() => log.push('second'))
        return 'value'
      }, undefined, steps(log))
    } finally {
      console.error = originalError
    }

    expect(log).toEqual(['begin', 'commit', 'end', 'second'])
  })
})

describe('afterRollback', () => {
  test('runs once the outermost rolls back, latest first', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    await scope.run(async () => {
      scope.afterRollback(() => log.push('first'))
      await scope.run(() => scope.afterRollback(() => log.push('second')), undefined, steps(log))
      throw new Error('boom')
    }, undefined, steps(log)).catch(() => {})

    expect(log).toEqual(['begin', 'rollback', 'end', 'second', 'first'])
  })

  test('never runs on a commit, nor outside a transaction', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    scope.afterRollback(() => log.push('outside'))
    await scope.run(() => scope.afterRollback(() => log.push('callback')), undefined, steps(log))

    expect(log).toEqual(['begin', 'commit', 'end'])
  })

  test('runs when the commit fails', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    await scope.run(() => scope.afterRollback(() => log.push('callback')), undefined, { ...steps(log), commit: () => { throw new Error('disk full') } }).catch(() => {})

    expect(log).toEqual(['begin', 'rollback', 'end', 'callback'])
  })
})

describe('a commit that fails', () => {
  test('rolls back, ends, throws, and runs no callback', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    const failing = scope.run(() => {
      scope.afterCommit(() => log.push('callback'))
    }, undefined, { ...steps(log), commit: () => { throw new Error('disk full') } })

    await expect(failing).rejects.toThrow('disk full')
    expect(log).toEqual(['begin', 'rollback', 'end'])
  })
})

describe('a write that comes during a rollback', () => {
  test('runs in a transaction of its own, after it', async () => {
    const scope = new TransactionScope()
    const log: string[] = []
    let late!: Promise<void>

    await scope.run(() => {
      late = new Promise<void>(resolve => setTimeout(() => resolve(scope.run(() => { log.push('late') }, undefined, steps(log))), 1))
      throw new Error('boom')
    }, undefined, { ...steps(log), rollback: async () => { await Bun.sleep(5); log.push('rollback') } }).catch(() => {})
    await late

    expect(log).toEqual(['begin', 'rollback', 'end', 'begin', 'late', 'commit', 'end'])
  })
})

describe('exclusive', () => {
  test('runs one at a time, in the order they asked', async () => {
    const scope = new TransactionScope()
    const log: string[] = []
    const slow = (name: string, ms: number) => scope.exclusive(async () => {
      log.push(`${name} starts`)
      await Bun.sleep(ms)
      log.push(`${name} ends`)
    })

    await Promise.all([slow('a', 5), slow('b', 1), slow('c', 0)])

    expect(log).toEqual(['a starts', 'a ends', 'b starts', 'b ends', 'c starts', 'c ends'])
  })

  test('one that gave up waiting never runs', async () => {
    const scope = new TransactionScope(10)
    const log: string[] = []

    const holder = scope.exclusive(() => Bun.sleep(30))
    const gaveUp = scope.exclusive(() => { log.push('ran') })
    await expect(gaveUp).rejects.toThrow('Waited 10 ms')
    await holder
    await scope.drain()

    expect(log).toEqual([])
  })
})

describe('drain', () => {
  test('waits for everything queued', async () => {
    const scope = new TransactionScope()
    const log: string[] = []

    void scope.exclusive(async () => {
      await Bun.sleep(5)
      log.push('done')
    })
    await scope.drain()

    expect(log).toEqual(['done'])
  })
})

describe('guard', () => {
  test('is taken inside a transaction, and is all a serial store needs', async () => {
    const scope = new TransactionScope()

    await expect(scope.guard(['stock:p1'])).rejects.toThrow('inside a transaction')
    await scope.run(() => scope.guard(['stock:p1']), undefined, steps([]))
  })

  test('a store whose transactions run side by side takes locks of its own', async () => {
    const scope = new TransactionScope(undefined, false)

    await expect(scope.run(() => scope.guard(['stock:p1']), undefined, steps([]))).rejects.toThrow('locks of its own')
  })
})

describe('state', () => {
  test('is the one of the transaction in progress, and only while it is open', async () => {
    const scope = new TransactionScope<{ writes: string[] }>()
    const state = { writes: [] }
    let late: unknown = 'not read'

    const seen = await scope.run(() => {
      setTimeout(() => { late = scope.state }, 1)
      return scope.state
    }, state, { ...steps([]), commit: () => Bun.sleep(5) })

    expect(seen).toBe(state)
    expect(late).toBeUndefined()
    expect(scope.state).toBeUndefined()
  })
})
