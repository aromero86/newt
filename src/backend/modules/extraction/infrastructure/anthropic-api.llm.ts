import type { Llm, LlmRequest } from './llm'

/** Claude through the Anthropic API, with an API key: for newt running on a server. */
export class AnthropicApiLlm implements Llm {

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async answer({ system, prompt, schema }: LlmRequest): Promise<unknown> {
    if (!this.apiKey) throw new Error('NEWT_ANTHROPIC_API_KEY is not set')
    // The answer comes as the input of the one tool it is made to call: that keeps it to the schema.
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: this.model || 'claude-sonnet-5-5',
        max_tokens: 16_000,
        system,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ name: 'answer', description: 'Give the answer.', input_schema: schema }],
        tool_choice: { type: 'tool', name: 'answer' },
      }),
    })
    if (!response.ok) throw new Error(`the Anthropic API answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const body = await response.json() as { content: { type: string, input?: unknown }[] }
    const call = body.content.find(block => block.type === 'tool_use')
    if (!call) throw new Error('the Anthropic API gave no answer')
    return call.input
  }
}
