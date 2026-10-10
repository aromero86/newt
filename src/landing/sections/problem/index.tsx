import { Grid } from '@newt/ui/components/grid'
import type { Lang } from '../../i18n'
import { people } from '../../story'
import { Section, SectionHeading } from '../../ui/site/section'
import { ProblemCard } from '../../ui/scenes/problem/card'
import { Drift } from '../../ui/scenes/problem/drift'
import { Clash } from '../../ui/scenes/problem/clash'
import { Queue } from '../../ui/scenes/problem/queue'
import { content } from './content'

export function ProblemSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  return (
    <Section id="problem">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.lead}
      </SectionHeading>
      <Grid columns={{ base: 1, md: 3 }} gap={4}>
        <ProblemCard title={copy.drift.title} text={copy.drift.text} delay={0}>
          <Drift copy={copy.drift} />
        </ProblemCard>
        <ProblemCard title={copy.clash.title} text={copy.clash.text} delay={0.08}>
          <Clash copy={copy.clash} />
        </ProblemCard>
        <ProblemCard title={copy.queue.title} text={copy.queue.text} delay={0.16}>
          <Queue copy={copy.queue} reviewer={people.dev} />
        </ProblemCard>
      </Grid>
    </Section>
  )
}
