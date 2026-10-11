import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

type CodeBlockProps = {
  /** What it is, for screen readers and the copy button. */
  label: string
  children: string
}

/** A command or a snippet to copy as it is, with a button that copies it. */
export function CodeBlock({ label, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative rounded-md border bg-muted/60">
      <pre aria-label={label} className="overflow-x-auto p-3 pr-11 font-mono text-xs leading-relaxed">{children}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {copied ? <CheckIcon aria-hidden className="size-4 text-ok" /> : <CopyIcon aria-hidden className="size-4" />}
      </button>
    </div>
  )
}
