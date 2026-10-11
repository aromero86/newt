import type { ReactNode } from 'react'

/**
 * One narrow column in the middle of the screen, for focused pages: signing in,
 * signing up. Over the landing's backdrop: a faint grid and a glow of the brand.
 */
export function NarrowPage({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_65%)]" />
      <div aria-hidden className="pointer-events-none absolute -top-56 left-1/2 h-[520px] w-[860px] -translate-x-1/2 rounded-full bg-brand/15 blur-3xl" />
      <div className="relative flex w-full max-w-sm flex-col gap-6">{children}</div>
    </main>
  )
}
