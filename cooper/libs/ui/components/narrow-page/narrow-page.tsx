import type { ReactNode } from 'react'

/**
 * One narrow column in the middle of the screen, for focused pages: signing in,
 * signing up, granting access. Like GitHub's sign-in page: the subtle canvas and
 * nothing else.
 */
export function NarrowPage({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-start justify-center bg-subtle px-4 py-16 text-foreground">
      <div className="flex w-full max-w-sm flex-col gap-5">{children}</div>
    </main>
  )
}
