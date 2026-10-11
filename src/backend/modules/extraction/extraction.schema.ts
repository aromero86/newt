import { z } from 'zod'
import type { DeltaInputDTO } from '../delta/delta.schema'
import { RuleCriterionSchema, RuleKindSchema } from '../rule/rule.schema'

export const ExtractionModuleName = 'extraction'

/**
 * A delta as the language model writes it: by names and keys, as people read the
 * definition. Fields that do not apply to its kind are null.
 */
export const ExtractedDeltaSchema = z.object({
  ref: z.string().describe('A short name for this delta in this answer, such as d1: other deltas of this answer use it to point at what this one creates'),
  previousId: z.string().nullable().describe('The id of the previous delta this one is: the same change to the same artifact, even if the document now words it differently. Null when new'),
  kind: z.enum(['feature-area', 'feature', 'rule']),
  operation: z.enum(['create', 'change', 'retire']),
  target: z.string().nullable().describe('What it changes or retires: an area or feature id, or a rule key such as R-2. Null to create'),
  area: z.string().nullable().describe('Features: the id of an existing area, or the ref of an area this answer creates. Null for the rest, and to keep a feature where it is'),
  feature: z.string().nullable().describe('Rules it creates: the id of an existing feature, the ref of a feature this answer creates, or the id of a previous delta that creates one. Null for the rest'),
  name: z.string().nullable().describe('Areas and features'),
  description: z.string().nullable().describe('Areas and features: what it covers and what it does not'),
  ruleKind: RuleKindSchema.nullable(),
  statement: z.string().nullable().describe('Rules: the one verifiable truth it states'),
  why: z.string().nullable().describe('Rules: why it holds'),
  scope: z.array(z.object({ dimension: z.string(), values: z.array(z.string()) })).nullable().describe('Rules: for each dimension it does not hold in all values of, the values it holds in, by name. Empty: everywhere'),
  criteria: z.array(RuleCriterionSchema).nullable().describe('Rules: given/when/then examples taken from the document'),
  sources: z.array(z.string()).describe('The sentences of the document it comes from, copied verbatim'),
})

export const ExtractionAnswerSchema = z.object({
  deltas: z.array(ExtractedDeltaSchema),
  questions: z.array(z.object({
    question: z.string(),
    sources: z.array(z.string()).describe('The sentences of the document it is about, verbatim'),
  })).describe('What keeps a delta from being written as the document wants: where a change applies, which feature it belongs to… Not the open questions the document itself lists'),
})

/** A question the extraction could not answer from the document, for its author. */
export const ExtractionQuestionSchema = z.object({ question: z.string(), sources: z.array(z.string()) })

export type ExtractedDelta = z.infer<typeof ExtractedDeltaSchema>
export type ExtractionAnswer = z.infer<typeof ExtractionAnswerSchema>
export type ExtractionQuestionDTO = z.infer<typeof ExtractionQuestionSchema>

/**
 * What a document says to change, ready to write: each delta with the previous one
 * it is (if any), its ref for the deltas after it, and its input with ids.
 */
export type ExtractionDTO = {
  deltas: { previousId: string | null, ref: string, input: DeltaInputDTO }[]
  questions: ExtractionQuestionDTO[]
}
