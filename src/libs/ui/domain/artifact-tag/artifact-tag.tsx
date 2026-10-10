import type { ReactNode } from 'react'
import { cn } from 'cn'
import type { ArtifactKind } from '../types'

const kindLook: Record<ArtifactKind, string> = {
  rule: 'text-brand',
  entity: 'text-info',
  lifecycle: 'text-[#a371f7]',
  actor: 'text-warn',
  parameter: 'text-brand-2',
  feature: 'text-foreground',
}

/** Text in the colour of an artifact kind, e.g. the word "rules" in a list of kinds. */
export function ArtifactKindLabel({ kind, children }: { kind: ArtifactKind; children: ReactNode }) {
  return <span className={cn(kindLook[kind])}>{children}</span>
}

/** A reference to an artifact: its kind and id, e.g. `rule R-12`. */
export function ArtifactTag({ kind, id }: { kind: ArtifactKind; id?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap">
      <span className={cn(kindLook[kind])}>{kind}</span>
      {id && <span className="text-muted-foreground">{id}</span>}
    </span>
  )
}
