import type { Lang } from '../../i18n'
import { storyIn } from '../../story'
import { Section, SectionHeading } from '../../ui/site/section'
import { ScreenGrid, ScreenTile } from '../../ui/scenes/screens/tile'
import { ProposalScreen } from '../../ui/scenes/screens/proposal-screen'
import { DefinitionScreen } from '../../ui/scenes/screens/definition-screen'
import { BoardScreen } from '../../ui/scenes/screens/board-screen'
import { BugScreen } from '../../ui/scenes/screens/bug-screen'
import { content } from './content'

/** The app, imagined: a proposal, the definition, the board and a bug. */
export function ScreensSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  const story = storyIn(lang)
  return (
    <Section id="screens">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.intro}
      </SectionHeading>
      <ScreenGrid>
        <ScreenTile span={3} title={copy.tiles.proposal.title} text={copy.tiles.proposal.text}>
          <ProposalScreen copy={copy.proposal} story={story} />
        </ScreenTile>
        <ScreenTile span={2} title={copy.tiles.definition.title} text={copy.tiles.definition.text}>
          <DefinitionScreen copy={copy.definition} story={story} />
        </ScreenTile>
        <ScreenTile span={3} title={copy.tiles.board.title} text={copy.tiles.board.text}>
          <BoardScreen copy={copy.board} />
        </ScreenTile>
        <ScreenTile span={2} title={copy.tiles.bug.title} text={copy.tiles.bug.text}>
          <BugScreen copy={copy.bug} bug={story.bug} />
        </ScreenTile>
      </ScreenGrid>
    </Section>
  )
}
