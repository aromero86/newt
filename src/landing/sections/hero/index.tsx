import { Emphasis } from '@newt/ui/components/text'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import type { Lang } from '../../i18n'
import { DOCS_URL, REPO_URL } from '../../links'
import { storyIn } from '../../story'
import { Highlight } from '../../ui/site/section'
import { GithubMark } from '../../ui/site/icons'
import { HeroActions, HeroBadge, HeroLead, HeroPerks, HeroPitch, HeroStage, HeroTitle } from '../../ui/scenes/hero/stage'
import { HeroLoop } from '../../ui/scenes/hero/loop'
import { content } from './content'

export function HeroSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  return (
    <HeroStage>
      <HeroPitch>
        <HeroBadge href="#open-source">{copy.badge}</HeroBadge>
        <HeroTitle>
          {copy.title}
          <Highlight>{copy.highlight}</Highlight>
        </HeroTitle>
        <HeroLead>
          {copy.lead}
          <Emphasis>{copy.leadStrong}</Emphasis>.
        </HeroLead>
        <HeroActions>
          <Button size="lg" href={REPO_URL}>
            <Icon icon={GithubMark} /> {copy.star}
          </Button>
          <Button size="lg" variant="outline" href={DOCS_URL}>
            {copy.quickstart} <Icon icon={ArrowRightIcon} />
          </Button>
        </HeroActions>
        <HeroPerks perks={copy.perks} />
      </HeroPitch>
      <HeroLoop copy={copy.loop} story={storyIn(lang)} />
    </HeroStage>
  )
}
