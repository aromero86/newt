#!/usr/bin/env bun
import { main } from '../src/cli'

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  console.error(`newt-graph: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
