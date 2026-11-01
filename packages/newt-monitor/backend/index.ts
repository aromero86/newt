#!/usr/bin/env bun
// bun packages/newt-monitor/backend/index.ts: newt-monitor in production. Its settings
// from the environment, its contexts served on one port until SIGINT or SIGTERM; one
// it cannot start with says why, and nothing starts.
import { main } from './main'

try {
  await main(process.env)
} catch (error) {
  console.error(`newt-monitor: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
