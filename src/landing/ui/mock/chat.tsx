import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { SparklesIcon } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@newt/ui/components/avatar'

/** A conversation with Claude, the way people talk to newt. */
export function ChatPanel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl border bg-card shadow-xl shadow-black/10', className)}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-xs font-medium">
        <span className="flex size-5 items-center justify-center rounded-md bg-[#d97757] text-white">
          <SparklesIcon className="size-3" />
        </span>
        {title}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 text-sm">{children}</div>
    </div>
  )
}

/** One message. `from="claude"` is the assistant; anything else is a person's name. */
export function ChatMessage({ from, children }: { from: string; children: ReactNode }) {
  const claude = from === 'claude'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn('flex gap-2.5', !claude && 'flex-row-reverse')}
    >
      {claude ? (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#d97757] text-white">
          <SparklesIcon className="size-3" />
        </span>
      ) : (
        <Avatar name={from} />
      )}
      <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 leading-relaxed', claude ? 'rounded-tl-sm bg-muted' : 'rounded-tr-sm bg-brand/15')}>
        {children}
      </div>
    </motion.div>
  )
}

/** A tool call Claude makes against newt, shown inline in the chat. */
export function ToolCall({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="ml-8 rounded-lg border border-dashed bg-subtle px-3 py-1.5 font-mono text-[11px] text-muted-foreground"
    >
      <span className="text-brand">newt</span>.{name}
      {children && <span className="ml-1.5">{children}</span>}
    </motion.div>
  )
}
