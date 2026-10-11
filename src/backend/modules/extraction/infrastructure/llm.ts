/** One question to a language model, answered with JSON that follows a schema. */
export type LlmRequest = {
  system: string
  prompt: string
  /** JSON Schema of the answer. */
  schema: Record<string, unknown>
}

/** A language model behind whatever provider runs it. */
export interface Llm {
  /** The answer, already following the schema; throws when there is none. */
  answer(request: LlmRequest): Promise<unknown>
}
