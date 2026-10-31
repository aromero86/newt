#!/usr/bin/env bun
import { main } from '../backend/main'

try {
  await main(process.env)
} catch (error) {
  console.error(`newt-monitor: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
