import type { ModuleNames } from './module-names'

/**
 * The files of a new module, by their path in its folder: the anatomy newt's lint
 * keeps, one use case to create and one to get, an event, an error, its routes and a
 * test. Its repository's scope is the one decision left to whoever fills it in.
 */
export function moduleTemplates(n: ModuleNames): Record<string, string> {
  const M = n.entity
  return {
    [`${n.folder}.schema.ts`]: `import { z } from 'zod'

/** A ${n.words}, as its module keeps it and tells it: its public contract. */
export const ${M}Schema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(100),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What a client sends to create one: the entity's own rules, picked. */
export const ${M}CreateSchema = ${M}Schema.pick({ name: true })

export type ${M}DTO = z.infer<typeof ${M}Schema>
export type ${M}CreateDTO = z.input<typeof ${M}CreateSchema>
`,

    [`${n.folder}.ts`]: `import { Entity, type EntityInput } from 'newt-kit/core'
import { ${M}_Created } from './events/${n.folder}-created'
import { ${M}Schema, type ${M}DTO } from './${n.folder}.schema'

export * from './${n.folder}.schema'

/** A ${n.words}: the only code that changes one, with methods named after what happened. */
export class ${M} extends Entity<typeof ${M}Schema> {

  private constructor(input: EntityInput<${M}DTO>, isNew: boolean) {
    super(${M}Schema, input, isNew)
  }

  static fromDTO(dto: ${M}DTO & { version: number }): ${M} {
    return new ${M}(dto, false)
  }

  static create(input: { name: string }): ${M} {
    const created = new ${M}(input, true)
    created.trackEvent(new ${M}_Created(created.toDTO()))
    return created
  }
}
`,

    [`${n.folder}.repository.ts`]: `import { TableRepository } from 'newt-kit/repository'
import type { Base } from 'newt-kit/runtime'
import { ${M}, type ${M}DTO } from './${n.folder}'

export type ${M}Row = ${M}DTO & { version: number }

/** The only code that touches the store for ${n.words}s. */
export class ${M}_Repository extends TableRepository<${M}, ${M}Row> {

  constructor(base: Base) {
    // DECIDE its scope, and say why. Rows of a tenant: { field: 'workspaceId', current: currentWorkspaceId },
    // with the field in the schema. Rows of none (people, a catalog shared by all): 'none', and the reason here.
    super(base, base.store.table<${M}Row>('${n.table}'), { scope: 'none' })
  }

  protected toEntity(row: ${M}Row): ${M} {
    return ${M}.fromDTO(row)
  }
}
`,

    [`${n.folder}.module.ts`]: `import { eventsOf, Module, UseCase } from 'newt-kit/core'
import type { HttpRouter } from 'newt-kit/http'
import type { Base } from 'newt-kit/runtime'
import { ${M}NotFound } from './errors/${n.folder}-not-found'
import { ${M}_Created } from './events/${n.folder}-created'
import { ${M}, ${M}CreateSchema, type ${M}DTO } from './${n.folder}'
import type { ${M}_Deps } from './${n.folder}.deps'
import { ${M}_Repository } from './${n.folder}.repository'
import { register${M}Routes } from './${n.folder}.routes'

/** The ${n.words}s: say in one line the one thing this module owns. */
export class ${M}_Module extends Module {

  /** \`base\` is the context's: replace \`Base & { http }\` with its own base. */
  static initialize(base: Base & { readonly http: HttpRouter }, deps: ${M}_Deps): ${M}_Module {
    const module = new ${M}_Module(base, new ${M}_Repository(base), deps)
    register${M}Routes(base.http, module)
    return module
  }

  readonly events

  private constructor(base: Base, private readonly repo: ${M}_Repository, private readonly deps: ${M}_Deps) {
    super('${n.module}', base.invocations, deps)
    this.events = eventsOf(base.bus, { created: ${M}_Created })
  }

  @UseCase()
  async create(input: unknown): Promise<${M}DTO> {
    const { name } = ${M}CreateSchema.parse(input)
    const created = ${M}.create({ name })
    await this.repo.persist(created)
    return created.toDTO()
  }

  @UseCase()
  async get(id: string): Promise<${M}DTO> {
    return (await this.load(id)).toDTO()
  }

  private load(id: string): Promise<${M}> {
    return this.resolve(() => this.repo.find({ id }), () => new ${M}NotFound(id))
  }
}
`,

    [`${n.folder}.deps.ts`]: `/**
 * What the ${n.words}s need: the modules it calls, of its context or of another (under
 * that context's name: \`auth: { access: Access_Module }\`), and ports in its own words
 * for what is no module of the application (a mailer). Types only (\`import type\`).
 */
export interface ${M}_Deps {}
`,

    [`${n.folder}.routes.ts`]: `import type { HttpRouter } from 'newt-kit/http'
import type { ${M}_Module } from './${n.folder}.module'

/** Read the request, call a use case, answer: a body goes to the use case as it came. */
export function register${M}Routes(http: HttpRouter, ${n.plural}: ${M}_Module): void {
  http.post('/${n.path}', async request => Response.json(await ${n.plural}.create(await request.json()), { status: 201 }))

  http.get('/${n.path}/:id', async request => Response.json(await ${n.plural}.get(request.params.id)))
}
`,

    [`events/${n.folder}-created.ts`]: `import { now, type DomainEvent } from 'newt-kit/core'
import type { ${M}DTO } from '../${n.folder}.schema'

export class ${M}_Created implements DomainEvent<${M}DTO> {
  static readonly eventName = '${n.module}.created'
  readonly name = ${M}_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: ${M}DTO) {}
}
`,

    [`errors/${n.folder}-not-found.ts`]: `import { NotFoundError } from 'newt-kit/core'

export class ${M}NotFound extends NotFoundError {
  readonly code = '${n.module}.not_found'
  constructor(id: string) {
    super(\`There is no ${n.words} \${id}\`)
  }
}
`,

    [`${n.folder}.test.ts`]: `import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileStore } from 'newt-kit/adapter-files'
import { HttpRouter } from 'newt-kit/http'
import { Base } from 'newt-kit/runtime'
import { ${M}_Module } from './${n.folder}.module'

// Opened on its own here; once the context has a helper that opens it for tests, use that.
class TestBase extends Base {
  readonly http = new HttpRouter()
}

describe('${n.module}', () => {
  const folder = join(tmpdir(), \`${n.folder}-\${Bun.randomUUIDv7()}\`)
  let base: TestBase
  let ${n.plural}: ${M}_Module

  beforeEach(async () => {
    base = new TestBase({ name: 'test', store: await FileStore.open({ folder }) })
    ${n.plural} = ${M}_Module.initialize(base, {})
  })

  afterEach(async () => {
    await base.close()
    await rm(folder, { recursive: true, force: true })
  })

  test('creates one, and finds it by its id', async () => {
    const created = await ${n.plural}.create({ name: ' First ' })

    expect(await ${n.plural}.get(created.id)).toMatchObject({ id: created.id, name: 'First' })
  })

  test('refuses a name it cannot keep', async () => {
    await expect(${n.plural}.create({ name: '  ' })).rejects.toThrow()
  })

  test('says there is none for an id it does not have', async () => {
    await expect(${n.plural}.get(Bun.randomUUIDv7())).rejects.toMatchObject({ code: '${n.module}.not_found' })
  })
})
`,
  }
}
