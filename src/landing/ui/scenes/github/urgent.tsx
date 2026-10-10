import type { ReactNode } from 'react'
import { BugIcon } from 'lucide-react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { BugBadge } from '@newt/ui/domain/bug-badge'
import { CheckLine } from '@newt/ui/domain/check-line'
import { GitHubWindow } from '../../mock/window'
import { Typing } from '../../motion/typing'
import { hotfixPr } from './data'
import { Frame, useScene, type SceneProps } from './frame'
import { Checks, Comment, MergeBox, NewtSide, Pop, type UrgentLabels } from './parts'
import { Badge } from '@newt/ui/components/badge'

export type UrgentCopy = {
  captions: string[]
  prTitle: string
  /** The reason the dev gives for the urgent lane. */
  reason: string
  draftedTitle: string
  resolves: string
  occurrences: string
  needsDecision: string
  newTransition: string
  blockedReason: string
  reasonLabel: string
  urgent: UrgentLabels
  mergedBy: ReactNode
  sideTitle: string
  mergedWithoutAcceptance: string
  originBy: string
  validate: string
}

/** 4. The urgent lane: a hotfix merges without an accepted proposal, and newt records it for product. */
export function UrgentScene({ copy, story, onDone }: SceneProps<UrgentCopy>) {
  const { bug } = story
  const stepper = useScene(copy.captions.length, onDone)
  const { step } = stepper
  const merged = step >= 2

  return (
    <Frame stepper={stepper} captions={copy.captions}>
      <GitHubWindow number={hotfixPr.number} title={copy.prTitle} state={merged ? 'merged' : 'blocked'} bodyClassName="space-y-3 p-3 sm:p-4">
        <Comment author={story.people.dev} meta="opened this pull request">
          <div className="flex flex-wrap items-center gap-2">
            <span>{copy.resolves}</span>
            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold">
              <BugIcon className="size-3.5 text-bad" /> {bug.id}
            </span>
            <BugBadge state={step >= 3 ? 'resolved' : 'confirmed'} />
            <span className="text-[11px] text-muted-foreground">
              {bug.occurrences} {copy.occurrences} · {bug.source}
            </span>
          </div>
          <p className="text-muted-foreground">{bug.title}</p>
        </Comment>
        {!merged && (
          <Checks newt="fail" detail={copy.needsDecision}>
            <CheckLine result="fail">
              <ArtifactTag kind="lifecycle" id="Order" /> {copy.newTransition}
            </CheckLine>
          </Checks>
        )}
        {step === 0 && (
          <Pop key="blocked">
            <MergeBox state="blocked" reason={copy.blockedReason} />
          </Pop>
        )}
        {step === 1 && (
          <Pop key="urgent">
            <MergeBox
              state="urgent"
              pressed
              urgent={copy.urgent}
              reason={
                <span className="mt-1 block rounded-md border bg-background/60 px-2 py-1.5 font-mono text-[11px] text-foreground">
                  {copy.reasonLabel}: <Typing active text={copy.reason} speed={24} />
                </span>
              }
            />
          </Pop>
        )}
        {merged && (
          <Pop key="merged">
            <MergeBox state="merged" reason={copy.mergedBy} />
          </Pop>
        )}
      </GitHubWindow>
      {step >= 3 && (
        <Pop key="newt" className="mt-3 sm:ml-auto sm:w-80">
          <NewtSide title={copy.sideTitle}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-brand">{hotfixPr.drafted}</span>
              <span className="text-[11px]">{copy.draftedTitle}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge tone="warn">{copy.mergedWithoutAcceptance}</Badge>
              <span>{copy.originBy}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono">{bug.id}</span> <BugBadge state="resolved" />
            </div>
            <div className="text-[11px] font-medium text-brand">{copy.validate}</div>
          </NewtSide>
        </Pop>
      )}
    </Frame>
  )
}
