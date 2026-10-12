import { tmpdir } from 'node:os'
import type { Llm, LlmRequest } from './llm'

/** How long an answer may take before giving up. */
const TIMEOUT_MS = 180_000

/**
 * Claude through Claude Code (`claude -p`), with the session of the machine that
 * runs newt: no API key. Meant for running newt on one's own machine.
 */
export class ClaudeCliLlm implements Llm {

  constructor(private readonly model: string) {}

  async answer({ system, prompt, schema }: LlmRequest): Promise<unknown> {
    // The prompt goes through stdin: it carries the whole definition, and as an argument
    // it soon passes the kernel's limit for one argument (128 KiB, E2BIG).
    const claude = Bun.spawn([
      'claude', '-p',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(schema),
      '--system-prompt', system,
      '--model', this.model || 'sonnet',
      '--tools', '',
      // Nothing of the person's own Claude Code settings (their language, for one) gets in.
      '--restricted',
      '--strict-mcp-config',
      '--no-session-persistence',
    ], { cwd: tmpdir(), stdin: new TextEncoder().encode(prompt), stdout: 'pipe', stderr: 'pipe', timeout: TIMEOUT_MS })
    const [output, errors, code] = await Promise.all([new Response(claude.stdout).text(), new Response(claude.stderr).text(), claude.exited])
    if (code !== 0) throw new Error(`claude -p exited with ${code}: ${(errors || output).slice(0, 300)}`)
    const result = JSON.parse(output) as { is_error?: boolean, result?: string, structured_output?: unknown }
    if (result.is_error || result.structured_output === undefined) throw new Error(`claude -p gave no answer: ${String(result.result ?? '').slice(0, 300)}`)
    return result.structured_output
  }
}
