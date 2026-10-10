import type { IconComponent } from '@newt/ui/components/icon'
import { Reveal } from '../../motion/reveal'

/** One of the four things newt is: an icon in a tinted square, a title, a sentence. */
export function Pillar({ icon: Glyph, title, text, delay }: { icon: IconComponent; title: string; text: string; delay: number }) {
  return (
    <Reveal delay={delay} className="rounded-2xl border bg-card p-5">
      <span className="flex size-9 items-center justify-center rounded-lg bg-brand/12 text-brand">
        <Glyph className="size-4" />
      </span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{text}</p>
    </Reveal>
  )
}
