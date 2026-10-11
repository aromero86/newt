import type { ReactNode } from 'react'

type AppShellProps = {
  /** The logo or app name, usually a link home. */
  brand: ReactNode
  /** What follows the brand: where you are, such as the workspace. */
  context?: ReactNode
  /** Buttons at the end of the bar. */
  actions?: ReactNode
  /** Text of the link that jumps past the bar to the content. */
  skipLabel?: string
  /** The page: it lays out its own width, from a full-width band to a narrow form. */
  children: ReactNode
}

/**
 * The frame of every app page: a thin bar with the brand, where you are and the
 * actions, and the page below it.
 */
export function AppShell({ brand, context, actions, skipLabel = 'Skip to content', children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-[3px] focus:ring-ring/50 focus:outline-none"
      >
        {skipLabel}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-12 w-full max-w-screen-xl items-center gap-3 px-4 md:px-6">
          <div className="flex shrink-0 items-center">{brand}</div>
          {context !== undefined && (
            <>
              <span aria-hidden className="text-lg font-light text-muted-foreground/50">/</span>
              <div className="flex min-w-0 items-center">{context}</div>
            </>
          )}
          {actions !== undefined && <div className="ml-auto flex items-center gap-1">{actions}</div>}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
    </div>
  )
}
