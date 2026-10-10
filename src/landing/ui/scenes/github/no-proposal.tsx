import type { ReactNode } from 'react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { CheckLine } from '@newt/ui/domain/check-line'
import { GitHubWindow } from '../../mock/window'
import { behaviorPr, technicalPr } from './data'
import { Frame, useScene, type SceneProps } from './frame'
import { Checks, Comment, MergeBox, Pop } from './parts'
import { Badge } from '@newt/ui/components/badge'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'

export type NoProposalCopy = {
  captions: string[]
  behaviorTitle: string
  draftedTitle: string
  behaviorBody: string
  type: string
  noLinked: string
  declaredDetail: ReactNode
  noLongerTrue: string
  draftedForYou: string
  originCode: string
  typeCorrection: string
  deltaChanged: string
  waitingFor: ReactNode
  technicalTitle: string
  technicalBody: string
  typeTechnical: string
  technicalDetail: string
  stillComply: ReactNode
}

/** 3. PRs with no proposal: a behavior change gets a drafted proposal and waits; a technical one goes through. */
export function NoProposalScene({ copy, story, onDone }: SceneProps<NoProposalCopy>) {
  const { people, rules } = story
  const breaks = rules[behaviorPr.breaks]
  const stepper = useScene(copy.captions.length, onDone)
  const { step } = stepper
  const technical = step >= 3

  return (
    <Frame stepper={stepper} captions={copy.captions}>
      {!technical ? (
        <Pop key="behavior">
          <GitHubWindow number={behaviorPr.number} title={copy.behaviorTitle} state="blocked" bodyClassName="space-y-3 p-3 sm:p-4">
            <Comment author={people.dev} meta="opened this pull request">
              <p>{copy.behaviorBody}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="muted">
                  {copy.type}: {behaviorPr.declared}
                </Badge>
                <Badge tone="muted">{copy.noLinked}</Badge>
              </div>
            </Comment>
            {step >= 1 && (
              <Pop>
                <Checks newt="fail" detail={copy.declaredDetail}>
                  <CheckLine result="fail">
                    <ArtifactTag kind="rule" id={breaks.id} /> {breaks.text} <span className="text-bad">{copy.noLongerTrue}</span>
                  </CheckLine>
                </Checks>
              </Pop>
            )}
            {step >= 2 && (
              <Pop>
                <Comment author="newt" bot meta="commented just now">
                  <p>{copy.draftedForYou}</p>
                  <div className="space-y-1.5 rounded-md border bg-background/60 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold text-brand">{behaviorPr.drafted}</span>
                      <span className="text-[11px]">{copy.draftedTitle}</span>
                      <span className="ml-auto">
                        <ProposalBadge state="in review" />
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                      <span className="rounded border px-1.5">{copy.originCode}</span>
                      <span className="rounded border px-1.5">{copy.typeCorrection}</span>
                      <span className="rounded border px-1.5">{copy.deltaChanged}</span>
                    </div>
                  </div>
                </Comment>
              </Pop>
            )}
            {step >= 2 && (
              <Pop>
                <MergeBox state="blocked" reason={copy.waitingFor} />
              </Pop>
            )}
          </GitHubWindow>
        </Pop>
      ) : (
        <Pop key="technical">
          <GitHubWindow number={technicalPr.number} title={copy.technicalTitle} state="open" bodyClassName="space-y-3 p-3 sm:p-4">
            <Comment author={people.dev} meta="opened this pull request">
              <p>{copy.technicalBody}</p>
              <Badge tone="muted">{copy.typeTechnical}</Badge>
            </Comment>
            <Checks newt="pass" detail={copy.technicalDetail}>
              <CheckLine result="pass">{copy.stillComply}</CheckLine>
            </Checks>
            <MergeBox state="ready" />
          </GitHubWindow>
        </Pop>
      )}
    </Frame>
  )
}
