import { defineScope } from 'newt/core'
import type { Member_Module } from './modules/member/member.module'

/** The workspace the work in progress is about: an auth tenant, by its id. */
export type WorkspaceScope = {
  workspaceId: string
}

/**
 * The workspace scope. A request under `/api/workspaces/:workspaceId` enters it once
 * its person is checked to belong (`workspaceRoutes`), and so does an MCP tool
 * (`inWorkspace`); a worker or a script, which knows its workspace already, enters it
 * with `runInWorkspace`. Every repository of `boards` sees only its rows.
 */
export const workspaceScope = defineScope<WorkspaceScope>('workspace', {
  missing: () => new Error('No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one'),
})

/** The id of the workspace the work in progress is about; throws outside one. */
export function currentWorkspaceId(): string {
  return workspaceScope.current().workspaceId
}

/** Runs in a workspace without checking who may: for workers and scripts, which already know. */
export function runInWorkspace<T>(workspaceId: string, fn: () => T): T {
  return workspaceScope.run({ workspaceId }, fn)
}

/** Runs in a workspace once the person signed in is checked to belong to it (404 otherwise): for the MCP tools. */
export async function inWorkspace<T>(members: Member_Module, workspaceId: string, fn: () => Promise<T>): Promise<T> {
  return workspaceScope.run(await members.enter(workspaceId), fn)
}
