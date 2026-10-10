import type { Lang } from '../../i18n'
import { storyIn } from '../../story'
import { Section, SectionHeading } from '../../ui/site/section'
import { Bento, BentoCell } from '../../ui/scenes/infographics/bento'
import { Bootstrap } from '../../ui/scenes/infographics/bootstrap'
import { BugsVsProposals } from '../../ui/scenes/infographics/bugs-vs-proposals'
import { CurrentVsPlanned } from '../../ui/scenes/infographics/current-vs-planned'
import { Gate } from '../../ui/scenes/infographics/gate'
import { Versions } from '../../ui/scenes/infographics/versions'
import { ViewedDeltas } from '../../ui/scenes/infographics/viewed-deltas'
import { content } from './content'

/** The key ideas of newt, one animated infographic each, in a bento grid. */
export function InfographicsSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  const story = storyIn(lang)
  return (
    <Section id="infographics">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.intro}
      </SectionHeading>

      <Bento>
        <BentoCell size="third">
          <CurrentVsPlanned copy={copy.currentVsPlanned} story={story} />
        </BentoCell>
        <BentoCell size="two-thirds" delay={0.05}>
          <Gate copy={copy.gate} story={story} />
        </BentoCell>
        <BentoCell size="half">
          <ViewedDeltas copy={copy.viewedDeltas} story={story} />
        </BentoCell>
        <BentoCell size="half" delay={0.05}>
          <Bootstrap copy={copy.bootstrap} lang={lang} />
        </BentoCell>
        <BentoCell size="half">
          <Versions copy={copy.versions} story={story} />
        </BentoCell>
        <BentoCell size="half" delay={0.05}>
          <BugsVsProposals copy={copy.bugsVsProposals} story={story} lang={lang} />
        </BentoCell>
      </Bento>
    </Section>
  )
}
