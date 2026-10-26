/** Whether a file system error says there is nothing there. */
export function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT'
}
