import { Fragment, useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { LinkComponentContext } from '../link/link-component'

/** Where you are, from the workspace down: `acme-shop / Proposals / PROP-3`. The last one is this page. */
export function Breadcrumbs({ items }: { items: { label: ReactNode, href?: string }[] }) {
  const Link = useContext(LinkComponentContext)
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-base">
      {items.map((item, index) => {
        const last = index === items.length - 1
        return (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden className="text-muted-foreground/60">/</span>}
            {item.href && !last
              ? <Link href={item.href} className="truncate text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:underline underline-offset-4">{item.label}</Link>
              : <span aria-current={last ? 'page' : undefined} className={cn('truncate', last ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{item.label}</span>}
          </Fragment>
        )
      })}
    </nav>
  )
}
