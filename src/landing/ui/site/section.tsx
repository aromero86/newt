import type { ReactNode } from 'react'
import { MotionConfig } from 'motion/react'
import { cn } from 'cn'

/**
 * One section of the page: an anchor, the page's width and spacing. Every
 * section is its own island, so this is also where motion learns to follow the
 * visitor's reduced-motion setting.
 */
export function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <section id={id} className="relative scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-6xl">{children}</div>
      </section>
    </MotionConfig>
  )
}

/**
 * The heading of a section: a short label, the title, and an optional
 * sentence. It fades in with CSS while it scrolls into view, so it needs no
 * JavaScript and stays readable where scroll-driven animations do not exist.
 */
export function SectionHeading({ eyebrow, title, children, center = false }: { eyebrow: string; title: ReactNode; children?: ReactNode; center?: boolean }) {
  return (
    <div className={cn('reveal-on-scroll mb-12 max-w-3xl', center && 'mx-auto text-center')}>
      <p className="mb-3 font-mono text-xs font-medium tracking-widest text-brand uppercase">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-lg text-pretty text-muted-foreground">{children}</p>}
    </div>
  )
}

/** Words painted with the brand gradient, inside a title. */
export function Highlight({ children }: { children: ReactNode }) {
  return <span className="text-gradient">{children}</span>
}
