import { ArrowRightIcon, ScanSearchIcon, ServerIcon, SparklesIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { Grid } from '@newt/ui/components/grid'
import { Icon } from '@newt/ui/components/icon'
import type { Lang } from '../../i18n'
import { REPO_URL } from '../../links'
import { Highlight, Section, SectionHeading } from '../../ui/site/section'
import { GithubMark } from '../../ui/site/icons'
import { Pillar } from '../../ui/scenes/open-source/pillar'
import { Roadmap, StatusRow } from '../../ui/scenes/open-source/status'
import { Quickstart } from '../../ui/scenes/open-source/quickstart'
import { ClosingCta } from '../../ui/scenes/open-source/cta'
import { content } from './content'

/** One icon per pillar, in the order of content.pillars. */
const pillarIcons = [ServerIcon, SparklesIcon, GithubMark, ScanSearchIcon]

/** Index of the roadmap stage being developed now. */
const now = 0

export function OpenSourceSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  return (
    <Section id="open-source">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.lead}
      </SectionHeading>
      <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap={4}>
        {copy.pillars.map((pillar, i) => (
          <Pillar key={pillar.title} icon={pillarIcons[i]!} title={pillar.title} text={pillar.text} delay={i * 0.06} />
        ))}
      </Grid>
      <StatusRow>
        <Roadmap copy={copy.roadmap} now={now} />
        <Quickstart copy={copy.quickstart} />
      </StatusRow>
      <ClosingCta
        title={
          <>
            {copy.cta.title}
            <Highlight>{copy.cta.highlight}</Highlight>
          </>
        }
        text={copy.cta.text}
        actions={
          <>
            <Button size="lg" href={REPO_URL}>
              <Icon icon={GithubMark} /> {copy.cta.star}
            </Button>
            <Button size="lg" variant="outline" href="#how">
              {copy.cta.how} <Icon icon={ArrowRightIcon} />
            </Button>
          </>
        }
      />
    </Section>
  )
}
