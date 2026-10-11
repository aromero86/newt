import { z } from 'zod'
import { Entity } from '../../core/entity/entity'
import type { EntityInput } from '../../core/entity/entity-input'
import { RuleRetired } from './errors/rule-retired'
import { RuleDraftSchema, RuleVersionSchema, type RuleDTO, type RuleVersionDTO } from './rule.schema'

export * from './rule.schema'

// What the rule keeps between versions, plus the version in force.
const RuleEntitySchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.uuidv7(),
  number: z.number().int().min(1),
  featureId: z.uuidv7(),
  retiredAt: z.string().nullable(),
  current: RuleVersionSchema,
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type RuleEntityDTO = z.infer<typeof RuleEntitySchema>
type RuleDraft = z.infer<typeof RuleDraftSchema>

/** What must always hold true. It is never edited: a new version replaces the current one. */
export class Rule extends Entity<typeof RuleEntitySchema> {

  private constructor(input: EntityInput<RuleEntityDTO>, isNew: boolean) {
    super(RuleEntitySchema, input, isNew)
  }

  static fromDTO(dto: RuleEntityDTO): Rule {
    return new Rule(dto, false)
  }

  static create(input: { id?: string, workspaceId: string, number: number, featureId: string, draft: RuleDraft }): Rule {
    const { draft, ...rest } = input
    return new Rule({ ...rest, retiredAt: null, current: version(draft, 1) }, true)
  }

  static keyOf(number: number): string {
    return `R-${number}`
  }

  get key(): string {
    return Rule.keyOf(this.data.number)
  }

  get featureId(): string {
    return this.data.featureId
  }

  get currentVersion(): RuleVersionDTO {
    return this.data.current
  }

  /** The contract, with the name of its feature. */
  toContract(featureName: string): RuleDTO {
    return { ...this.toDTO(), key: this.key, featureName }
  }

  /** A new version takes the place of the current one, which stays in the history. */
  supersede(draft: RuleDraft): void {
    if (this.data.retiredAt !== null) throw new RuleRetired(this.key)
    this.change({ current: version(draft, this.data.current.version + 1) })
  }

  retire(): void {
    if (this.data.retiredAt === null) this.change({ retiredAt: new Date().toISOString() })
  }
}

function version(draft: RuleDraft, number: number): RuleVersionDTO {
  return { ...draft, id: Bun.randomUUIDv7(), version: number, createdAt: new Date().toISOString() }
}
