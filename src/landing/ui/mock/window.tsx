import type { ReactNode } from 'react'
import { LockIcon } from 'lucide-react'
import { cn } from 'cn'
import { Logo } from '@newt/ui/domain/logo'
import { GithubMark } from '../site/icons'

/** Browser chrome: traffic lights and an address bar. */
function Chrome({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/20 ring-1 ring-black/5', className)}>
      <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-background/70 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          <LockIcon className="size-3 shrink-0" />
          <span className="truncate">{url}</span>
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * The newt app, imagined: a GitHub-like shell (breadcrumb, tabs) built for
 * product definitions. `tabs` are labels; `active` is the selected one.
 */
export function AppWindow({
  url = 'newt.acme.dev/acme-shop',
  crumbs,
  tabs,
  active,
  children,
  className,
  bodyClassName,
}: {
  url?: string
  crumbs: string[]
  tabs?: { label: string; count?: number }[]
  active?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Chrome url={url} className={className}>
      <div className="border-b bg-subtle px-4 pt-3">
        <div className="flex items-center gap-2 text-sm">
          <Logo size="sm" withName={false} />
          {crumbs.map((c, i) => (
            <span key={c} className="flex min-w-0 items-center gap-2">
              <span className="text-muted-foreground">/</span>
              <span className={cn('truncate', i === crumbs.length - 1 ? 'font-semibold' : 'text-muted-foreground')}>{c}</span>
            </span>
          ))}
        </div>
        {tabs && (
          // Tabs wrap to a second line on narrow screens instead of being cut off.
          <div className="mt-3 flex flex-wrap gap-x-1 text-xs">
            {tabs.map(t => (
              <span
                key={t.label}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-2.5 pb-2 whitespace-nowrap',
                  t.label === active ? 'border-brand font-medium text-foreground' : 'border-transparent text-muted-foreground',
                )}
              >
                {t.label}
                {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[10px]">{t.count}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={cn('relative', bodyClassName)}>{children}</div>
    </Chrome>
  )
}

/** github.com, imagined with newt installed: a pull request page. */
export function GitHubWindow({
  repo = 'acme/shop',
  number,
  title,
  state,
  tabs = ['Conversation', 'Commits', 'Checks', 'Files changed'],
  active = 'Conversation',
  children,
  className,
  bodyClassName,
}: {
  repo?: string
  number: number
  title: string
  state: 'open' | 'merged' | 'blocked'
  tabs?: string[]
  active?: string
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const badge = {
    open: 'bg-[#1f883d] text-white',
    blocked: 'bg-[#1f883d] text-white',
    merged: 'bg-[#8250df] text-white',
  }[state]
  return (
    <Chrome url={`github.com/${repo}/pull/${number}`} className={className}>
      <div className="border-b px-4 pt-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <GithubMark className="size-4 text-foreground" />
          <span>{repo}</span>
        </div>
        <div className="mt-2 text-base leading-snug font-semibold">
          {title} <span className="font-normal text-muted-foreground">#{number}</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className={cn('rounded-full px-2.5 py-0.5 font-medium capitalize', badge)}>{state === 'blocked' ? 'Open' : state}</span>
          <span className="text-muted-foreground">{state === 'merged' ? 'merged into main' : 'wants to merge into main'}</span>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto text-xs">
          {tabs.map(t => (
            <span
              key={t}
              className={cn('border-b-2 px-2.5 pb-2 whitespace-nowrap', t === active ? 'border-[#fd8c73] font-medium' : 'border-transparent text-muted-foreground')}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className={cn('relative', bodyClassName)}>{children}</div>
    </Chrome>
  )
}
