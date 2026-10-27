/** Text as it was written, in a monospaced block that keeps its lines and scrolls sideways: a stack, a query. */
export function CodeBlock({ label, children }: { label?: string, children: string }) {
  return (
    <pre aria-label={label} className="overflow-x-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-5 whitespace-pre text-foreground">
      {children}
    </pre>
  )
}
