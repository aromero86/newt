import type { ReactNode } from 'react'

/** One narrow column in the middle of the screen, for focused pages: signing in, signing up. */
export function NarrowPage({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex min-h-dvh items-start justify-center bg-background px-4 py-12 text-foreground sm:py-20">
      <div className="flex w-full max-w-sm flex-col gap-8">{children}</div>
    </main>
  )
}
