import type { ReactNode } from 'react'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { GitHubWindow } from '../../mock/window'
import { FakeCursor } from '../../motion/typing'
import { releaseVersion } from './data'
import { Frame, useScene, type SceneProps } from './frame'
import { GitHubRelease, LinkedProposal, MergeBox, NewtSide, Pop } from './parts'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'

export type ReleasedCopy = {
  captions: string[]
  mergedNote: ReactNode
  currentDefinition: string
  ops: { new: string; changed: string; retired: string }
  changelog: { changed: string; new: string }
  more: string
  sameVersion: string
}

const opLook = { new: 'text-ok', changed: 'text-warn', retired: 'text-bad' } as const

/** 5. Merged and released: the proposal merges with the PR, and a GitHub release is a product release. */
export function ReleasedScene({ copy, story, onDone }: SceneProps<ReleasedCopy>) {
  const { pr, proposal, deltas, releases, workspace } = story
  const release = releases.find(r => r.version === releaseVersion)!
  const stepper = useScene(copy.captions.length, onDone, 2800)
  const { step } = stepper
  const merged = step >= 1
  const published = step >= 3
  const after = (id: string) => deltas.find(d => d.id === id)!.after

  return (
    <Frame stepper={stepper} captions={copy.captions}>
      <div className="space-y-3">
        <GitHubWindow number={pr.number} title={pr.title} state={merged ? 'merged' : 'open'} bodyClassName="space-y-3 p-3 sm:p-4">
          <LinkedProposal id={proposal.id} title={proposal.title} state={merged ? 'merged' : 'accepted'} />
          {merged ? (
            <Pop key="merged">
              <MergeBox state="merged" reason={copy.mergedNote} />
            </Pop>
          ) : (
            <Pop key="ready">
              <MergeBox state="ready" pressed />
            </Pop>
          )}
          {step === 0 && <FakeCursor x={20} y={78} click />}
        </GitHubWindow>

        <div className="grid gap-3 sm:grid-cols-2">
          {merged && (
            <Pop key="definition">
              <NewtSide title={copy.currentDefinition}>
                <div className="flex items-center gap-2 text-[11px]">
                  <ProposalBadge state="accepted" faded /> → <ProposalBadge state="merged" />
                </div>
                <ul className="space-y-1">
                  {deltas.slice(0, 3).map(d => (
                    <li key={d.id} className="flex items-center gap-1.5 text-[11px]">
                      <span className="font-mono text-muted-foreground">{d.id}</span>
                      <ArtifactTag kind={d.kind} id={d.artifact} />
                      <span className={opLook[d.op]}>{copy.ops[d.op]}</span>
                    </li>
                  ))}
                  <li className="text-[11px] text-muted-foreground">{copy.more}</li>
                </ul>
              </NewtSide>
            </Pop>
          )}
          {step >= 2 && (
            <Pop key="release" className="space-y-3">
              {/* github.com is in English: so is its date. */}
              <GitHubRelease version={release.version} date={release.githubDate} published={published} />
              {published && (
                <Pop>
                  <NewtSide title={`Release ${release.version}`}>
                    <div className="font-medium">
                      Changelog · {workspace.product} {release.version}
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                      <li>
                        <span className="text-warn">{copy.changelog.changed}</span> · {after('Δ1')}
                      </li>
                      <li>
                        <span className="text-ok">{copy.changelog.new}</span> · {after('Δ2')}
                      </li>
                      <li>
                        <span className="text-ok">{copy.changelog.new}</span> · {after('Δ4')}
                      </li>
                    </ul>
                    <div className="text-[11px] font-medium text-brand">{copy.sameVersion}</div>
                  </NewtSide>
                </Pop>
              )}
            </Pop>
          )}
        </div>
      </div>
    </Frame>
  )
}
