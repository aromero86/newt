import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { Reveal } from '../../motion/reveal'

export type QuickstartCopy = {
  title: string
  badge: string
  text: string
  copy: string
  /** Shell commands; lines starting with `#` are comments. */
  commands: string
}

/** What getting started will look like, with a button to copy the commands. Holds the #quickstart anchor. */
export function Quickstart({ copy }: { copy: QuickstartCopy }) {
  return (
    <Reveal id="quickstart" className="scroll-mt-24 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{copy.title}</h3>
        <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] text-warn">{copy.badge}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{copy.text}</p>
      <Code text={copy.commands} label={copy.copy} />
    </Reveal>
  )
}

function Code({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be blocked; the text is still selectable.
    }
  }
  return (
    <div className="relative mt-4 rounded-xl border bg-background">
      <span className="absolute top-2 right-2">
        <Button variant="ghost" size="icon-sm" onClick={copy} label={label}>
          {copied ? <CheckIcon className="text-ok" /> : <CopyIcon />}
        </Button>
      </span>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
        {text.split('\n').map((line, i) => (
          <div key={i} className={line.startsWith('#') ? 'text-muted-foreground' : ''}>
            {line === '' ? ' ' : line.startsWith('#') ? line : <><span className="text-brand select-none">$ </span>{line}</>}
          </div>
        ))}
      </pre>
    </div>
  )
}
