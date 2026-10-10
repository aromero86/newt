import type { ReactNode } from 'react'
import { MotionConfig, motion } from 'motion/react'
import { ease } from '../../motion/stepper'

/**
 * The top of the page: its own section (not the shared `Section`), with the
 * grid and glow backdrop and two columns, the pitch and the animated loop.
 */
export function HeroStage({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <section id="hero" className="relative overflow-hidden px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
        <Backdrop />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.05fr_1fr]">{children}</div>
      </section>
    </MotionConfig>
  )
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
      <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand/20 blur-[120px]" />
      <div className="absolute top-40 -right-40 h-[400px] w-[500px] rounded-full bg-brand-2/15 blur-[120px]" />
    </div>
  )
}

/** The left column. */
export function HeroPitch({ children }: { children: ReactNode }) {
  return <div>{children}</div>
}

/** The pill above the title, with a pulsing dot: the project is in development. */
export function HeroBadge({ href, children }: { href: string; children: ReactNode }) {
  return (
    <motion.a
      href={href}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur hover:text-foreground"
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-warn opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-warn" />
      </span>
      {children}
    </motion.a>
  )
}

export function HeroTitle({ children }: { children: ReactNode }) {
  return (
    <motion.h1
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.05, ease }}
      className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
    >
      {children}
    </motion.h1>
  )
}

export function HeroLead({ children }: { children: ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.12, ease }}
      className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground"
    >
      {children}
    </motion.p>
  )
}


export function HeroActions({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2, ease }}
      className="mt-8 flex flex-wrap gap-3"
    >
      {children}
    </motion.div>
  )
}

/** The four selling points under the buttons, two by two. */
export function HeroPerks({ perks }: { perks: string[] }) {
  return (
    <motion.ul
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.35 }}
      className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground"
    >
      {perks.map(perk => (
        <li key={perk} className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-brand" /> {perk}
        </li>
      ))}
    </motion.ul>
  )
}
