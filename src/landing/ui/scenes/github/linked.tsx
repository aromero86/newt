import type { ReactNode } from 'react'
import { GitBranchIcon } from 'lucide-react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { CheckLine } from '@newt/ui/domain/check-line'
import { GitHubWindow } from '../../mock/window'
import { Typing } from '../../motion/typing'
import { annotatedLine, firstDiff, fixedDiff } from './data'
import { Frame, useScene, type SceneProps } from './frame'
import { Annotation, Checks, Comment, Diff, LinkedProposal, MergeBox, Pop } from './parts'
import { NewtMark } from '@newt/ui/domain/logo'

export type LinkedCopy = {
  captions: string[]
  body: string
  /** The commit message of the fix. */
  fixCommit: string
  checking: string
  passDetail: string
  failDetail: string
  guestCanPay: string
  anyAmount: string
  invoiceEmailed: string
  noTest: string
  viewInNewt: string
  blockedReason: ReactNode
  annotation: ReactNode
}

/** 1. The PR implements an accepted proposal: newt checks it and points at the line that breaks a rule. */
export function LinkedScene({ copy, story, onDone }: SceneProps<LinkedCopy>) {
  const { pr, proposal, people, rules, deltas } = story
  const stepper = useScene(copy.captions.length, onDone)
  const { step } = stepper
  const filesTab = step === 3
  const fixed = step >= 4
  const delta1 = deltas.find(d => d.id === 'Δ1')!
  const delta3 = deltas.find(d => d.id === 'Δ3')!
  const r07 = rules.accountOver500

  return (
    <Frame stepper={stepper} captions={copy.captions}>
      <GitHubWindow
        number={pr.number}
        title={pr.title}
        state="open"
        active={filesTab ? 'Files changed' : step >= 1 ? 'Checks' : 'Conversation'}
        bodyClassName="space-y-3 p-3 sm:p-4"
      >
        {!filesTab && (
          <Pop key="conversation" className="space-y-3">
            <Comment author={people.dev} meta="opened this pull request">
              <p>{copy.body}</p>
              <LinkedProposal id={proposal.id} title={proposal.title} state="accepted" />
            </Comment>
            {fixed && (
              <Pop>
                <div className="flex items-center gap-2 pl-9 text-[11px] text-muted-foreground">
                  <GitBranchIcon className="size-3.5" />
                  <span>
                    <b className="text-foreground">{people.dev}</b> pushed <span className="font-mono">{copy.fixCommit}</span>
                  </span>
                </div>
              </Pop>
            )}
            {step >= 1 && (
              <Pop>
                <Checks
                  newt={step === 1 ? 'running' : fixed ? 'pass' : 'fail'}
                  detail={step === 1 ? <Typing active text={copy.checking} speed={22} /> : fixed ? copy.passDetail : copy.failDetail}
                >
                  {step >= 2 && (
                    <>
                      <CheckLine result="pass">
                        <ArtifactTag kind="rule" id="R-12" /> {delta1.after} <span className="text-muted-foreground">· Δ1</span>
                      </CheckLine>
                      <CheckLine result="pass">
                        <ArtifactTag kind="lifecycle" id={delta3.artifact} /> {delta3.after} <span className="text-muted-foreground">· Δ3</span>
                      </CheckLine>
                      <CheckLine result="pass">
                        <ArtifactTag kind="actor" id="Guest" /> {copy.guestCanPay} <span className="text-muted-foreground">· Δ5</span>
                      </CheckLine>
                      <CheckLine result={fixed ? 'pass' : 'fail'}>
                        <ArtifactTag kind="rule" id={r07.id} /> {r07.text}
                        {!fixed && <span className="text-bad">{copy.anyAmount}</span>}
                      </CheckLine>
                      <CheckLine result="warn">
                        <ArtifactTag kind="rule" id={rules.invoiceByEmail.id} /> {copy.invoiceEmailed} — <span className="text-warn">{copy.noTest}</span>
                      </CheckLine>
                      <div className="pt-1 text-[11px]">
                        <span className="inline-flex items-center gap-1 text-brand">
                          <NewtMark size="sm" /> {copy.viewInNewt}
                        </span>
                      </div>
                    </>
                  )}
                </Checks>
              </Pop>
            )}
            {step >= 2 && (
              <Pop>
                <MergeBox state={fixed ? 'ready' : 'blocked'} reason={fixed ? undefined : copy.blockedReason} />
              </Pop>
            )}
          </Pop>
        )}
        {filesTab && (
          <Pop key="files">
            <Diff file={pr.file} lines={firstDiff} annotate={annotatedLine} annotation={<Annotation rule={r07.id}>{copy.annotation}</Annotation>} />
          </Pop>
        )}
        {fixed && (
          <Pop className="hidden sm:block">
            <Diff file={pr.file} lines={fixedDiff} highlight />
          </Pop>
        )}
      </GitHubWindow>
    </Frame>
  )
}
