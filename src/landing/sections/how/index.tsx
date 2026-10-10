import type { Lang } from '../../i18n'
import { storyIn } from '../../story'
import { Section, SectionHeading } from '../../ui/site/section'
import { HowSteps } from '../../ui/scenes/how/steps'
import { content } from './content'

/** How it works: one change, from a sentence to production, step by step. */
export function HowSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  return (
    <Section id="how">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.intro}
      </SectionHeading>
      <HowSteps steps={copy.steps} stages={copy.stages} story={storyIn(lang)} lang={lang} />
    </Section>
  )
}
