import type { ReactNode } from 'react'

type PageBandProps = {
  /** What the band is about: a workspace's name, with its icon. */
  title: ReactNode
  /** Badges or short facts beside the title. */
  meta?: ReactNode
  actions?: ReactNode
  /** The parts below it, as an `UnderlineNav`. */
  nav?: ReactNode
}

/** The band at the top of a workspace's pages, like a repository's header on GitHub: who it is and its parts. */
export function PageBand({ title, meta, actions, nav }: PageBandProps) {
  return (
    <div className="border-b bg-subtle">
      <div className="mx-auto w-full max-w-screen-xl px-4 md:px-6">
        <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 pt-4 pb-3">
          <div className="flex min-w-0 items-center gap-2 text-lg">{title}</div>
          {meta !== undefined && <div className="flex items-center gap-2">{meta}</div>}
          {actions !== undefined && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
        {nav}
      </div>
    </div>
  )
}
