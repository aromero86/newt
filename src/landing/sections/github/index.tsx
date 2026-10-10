import { CheckCheckIcon, GitMergeIcon, GitPullRequestIcon, LockIcon, ZapIcon } from 'lucide-react'
import type { Lang } from '../../i18n'
import { storyIn } from '../../story'
import { Section, SectionHeading } from '../../ui/site/section'
import { BlockedScene } from '../../ui/scenes/github/blocked'
import { LinkedScene } from '../../ui/scenes/github/linked'
import { NoProposalScene } from '../../ui/scenes/github/no-proposal'
import { GithubCards, ScenePlayer } from '../../ui/scenes/github/player'
import { ReleasedScene } from '../../ui/scenes/github/released'
import { UrgentScene } from '../../ui/scenes/github/urgent'
import { content } from './content'

/** Where newt meets the code: every scene is a PR on github.com with newt installed. */
export function GithubSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  const story = storyIn(lang)

  return (
    <Section id="github">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.lead}
      </SectionHeading>

      <ScenePlayer
        label={copy.tablist}
        scenes={[
          { id: 'linked', label: copy.tabs.linked, icon: CheckCheckIcon, render: onDone => <LinkedScene copy={copy.linked} story={story} onDone={onDone} /> },
          { id: 'blocked', label: copy.tabs.blocked, icon: LockIcon, render: onDone => <BlockedScene copy={copy.blocked} story={story} onDone={onDone} /> },
          {
            id: 'no-proposal',
            label: copy.tabs.noProposal,
            icon: GitPullRequestIcon,
            render: onDone => <NoProposalScene copy={copy.noProposal} story={story} onDone={onDone} />,
          },
          { id: 'urgent', label: copy.tabs.urgent, icon: ZapIcon, render: onDone => <UrgentScene copy={copy.urgent} story={story} onDone={onDone} /> },
          { id: 'released', label: copy.tabs.released, icon: GitMergeIcon, render: onDone => <ReleasedScene copy={copy.released} story={story} onDone={onDone} /> },
        ]}
      />

      <GithubCards cards={copy.cards} />
    </Section>
  )
}
