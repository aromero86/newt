import type { ReactNode } from 'react'

type AppShellProps = {
  /** The logo or app name, usually a link home. */
  brand: ReactNode
  /** The app's own router links. */
  nav?: ReactNode
  /** Accessible name of the navigation. */
  navLabel?: string
  /** Buttons at the end of the header. */
  actions?: ReactNode
  /** Text of the link that jumps past the header to the content. */
  skipLabel?: string
  /** The page. */
  children: ReactNode
}

/**
 * The frame of every app page: a header with brand, navigation and actions, and
 * the page below it. On narrow screens the navigation moves to its own row,
 * which scrolls sideways instead of overflowing.
 */
export function AppShell({ brand, nav, navLabel = 'Main', actions, skipLabel = 'Skip to content', children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-[3px] focus:ring-ring/50 focus:outline-none"
      >
        {skipLabel}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto grid w-full max-w-screen-xl grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 px-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:px-6">
          <div className="col-start-1 row-start-1 flex h-14 min-w-0 items-center">{brand}</div>
          {actions !== undefined && (
            <div className="col-start-2 row-start-1 flex items-center justify-self-end gap-2 md:col-start-3">{actions}</div>
          )}
          {nav !== undefined && (
            <nav
              aria-label={navLabel}
              className="col-span-2 row-start-2 -mx-4 flex h-11 min-w-0 items-center gap-1 overflow-x-auto border-t px-4 whitespace-nowrap *:shrink-0 md:col-span-1 md:col-start-2 md:row-start-1 md:mx-0 md:h-14 md:border-t-0 md:px-0"
            >
              {nav}
            </nav>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-8 outline-none md:px-6">
        {children}
      </main>
    </div>
  )
}
