export type Extraction_Options = {
  /** Which language model reads the documents: `claude-cli` runs `claude -p` with the session of the machine; `anthropic-api` uses an API key. */
  provider: 'claude-cli' | 'anthropic-api'
  /** The model, as the provider names it; empty for the provider's default. */
  model: string
  /** For `anthropic-api`. */
  apiKey: string
}
