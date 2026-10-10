import type { ReactNode } from 'react'
import { GitHubWindow } from '../../mock/window'
import { Typing } from '../../motion/typing'
import { blockedPr } from './data'
import { Frame, useScene, type SceneProps } from './frame'
import { Checks, Comment, LinkedProposal, MergeBox, NewtSide, Pop } from './parts'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'

export type BlockedCopy = {
  captions: string[]
  prTitle: string
  proposalTitle: string
  body: string
  acceptedChecking: string
  notRun: ReactNode
  waiting: string
  blockedReason: ReactNode
  acceptedBy: ReactNode
}

/** 2. The PR implements a proposal still under discussion: no check, no merge, until it is accepted. */
export function BlockedScene({ copy, story, onDone }: SceneProps<BlockedCopy>) {
  const { people } = story
  const id = blockedPr.proposal
  const stepper = useScene(copy.captions.length, onDone)
  const { step } = stepper
  const accepted = step >= 3

  return (
    <Frame stepper={stepper} captions={copy.captions}>
      <GitHubWindow number={blockedPr.number} title={copy.prTitle} state="blocked" bodyClassName="space-y-3 p-3 sm:p-4">
        <Comment author={people.dev} meta="opened this pull request">
          <p>{copy.body}</p>
          <LinkedProposal id={id} title={copy.proposalTitle} state={accepted ? 'accepted' : 'in review'} />
        </Comment>
        {step >= 1 && (
          <Pop key="checks">
            <Checks newt={accepted ? 'running' : 'skipped'} detail={accepted ? <Typing active text={copy.acceptedChecking} speed={22} /> : copy.notRun} />
          </Pop>
        )}
        {step >= 2 && (
          <Pop key="merge">
            <MergeBox state="blocked" reason={accepted ? copy.waiting : copy.blockedReason} />
          </Pop>
        )}
      </GitHubWindow>
      {accepted && (
        <Pop key="newt" className="mt-3 sm:ml-auto sm:w-80">
          <NewtSide title={id}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{copy.proposalTitle}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <ProposalBadge state="in review" faded /> → <ProposalBadge state="accepted" />
            </div>
            <div className="text-[11px] text-muted-foreground">{copy.acceptedBy}</div>
          </NewtSide>
        </Pop>
      )}
    </Frame>
  )
}
