import { useEffect, type FormEvent } from 'react'
import type { DeltaDTO, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Field } from '@newt/ui/components/field'
import { Inline } from '@newt/ui/components/inline'
import { Markdown } from '@newt/ui/components/markdown'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Textarea } from '@newt/ui/components/textarea'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaChanges } from '../../../../components/delta-changes'
import { FormField } from '../../../../components/form-field'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { ProposalDeltaAdd } from '../proposal-delta-add/proposal-delta-add'
import { ProposalDeltaAddService } from '../proposal-delta-add/proposal-delta-add.service'
import { KIND_LABEL, OPERATION_LABEL } from '../proposal-delta/proposal-delta'
import { ProposalService } from '../proposal.service'
import { ProposalWorkingService } from './proposal-working.service'

/** With its own services: whoever renders it needs nothing else. */
export function ProposalWorking({ proposal }: { proposal: ProposalDTO }) {
  return (
    <Provide services={[ProposalWorkingService, ProposalDeltaAddService]}>
      <ProposalWorkingWrapped proposal={proposal} />
    </Provide>
  )
}

/**
 * The working copy: the document and the deltas as they are being written. Saving
 * keeps them here; publishing a revision is what shows them to reviewers.
 */
function ProposalWorkingWrapped({ proposal }: { proposal: ProposalDTO }) {
  const service = useService(ProposalWorkingService)
  const add = useService(ProposalDeltaAddService)
  const draft = useValue(service.draft)
  const preview = useValue(service.preview)
  const saving = useValue(service.saving)
  const deltas = useValue(service.deltas.items)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)
  const publishing = useValue(service.publishForm.submitting)
  const editable = proposal.status === 'draft' || proposal.status === 'in review'
  const unsaved = draft !== proposal.document

  useEffect(() => {
    void service.load()
  }, [service])

  function onPublish(event: FormEvent) {
    event.preventDefault()
    void service.publish()
  }

  return (
    <Stack gap={6}>
      {editable && proposal.unpublished && proposal.revision > 0 && (
        <Card title="Unpublished changes" titleLevel={2} description="Reviewers still see the last revision. Publish these changes as a new one, or go back to it.">
          <form onSubmit={onPublish} noValidate>
            <Stack gap={3} align="start">
              <FormField form={service.publishForm} name="message" label="Message" description="Like a commit: what this revision changes." />
              <Inline gap={2}>
                <Button type="submit" loading={publishing}>Publish revision {proposal.revision + 1}</Button>
                <Button variant="ghost" onClick={() => void service.discard()}>Discard changes</Button>
              </Inline>
            </Stack>
          </form>
        </Card>
      )}
      {!editable && <Alert tone="info" title="The working copy is frozen">{`The proposal is ${proposal.status}: it takes no more changes.`}</Alert>}
      <Card
        title="Document"
        titleLevel={2}
        description="Context, problem, decisions and open questions, in Markdown."
        action={<Button size="sm" variant="ghost" onClick={() => service.togglePreview()}>{preview ? 'Write' : 'Preview'}</Button>}
      >
        <Stack gap={3}>
          {preview
            ? (draft ? <Markdown>{draft}</Markdown> : <Text size="sm" tone="muted">Nothing written yet.</Text>)
            : (
                <Field label="Document">
                  <Textarea value={draft} rows={14} disabled={!editable} onChange={value => service.type(value)} />
                </Field>
              )}
          {editable && (
            <Inline gap={2}>
              <Button size="sm" variant="secondary" disabled={!unsaved} loading={saving} onClick={() => void service.saveDocument()}>Save</Button>
              {unsaved && <Text size="sm" tone="muted">Not saved yet</Text>}
            </Inline>
          )}
        </Stack>
      </Card>
      <Stack gap={4}>
        <Text weight="semibold">{`Deltas in the working copy (${deltas.length}${hasMore ? '+' : ''})`}</Text>
        {deltas.length === 0 && <Text size="sm" tone="muted">No deltas yet: each one is a change to one artifact of the definition.</Text>}
        {deltas.map(delta => <ProposalWorkingDelta key={delta.id} delta={delta} editable={editable} />)}
        {hasMore && <Inline><Button size="sm" variant="outline" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></Inline>}
        {editable && <Inline><Button variant="secondary" onClick={() => add.start()}>Add a delta</Button></Inline>}
      </Stack>
      <ProposalDeltaAdd />
    </Stack>
  )
}

/** One delta of the working copy, and whether it differs from what is published. */
function ProposalWorkingDelta({ delta, editable }: { delta: DeltaDTO, editable: boolean }) {
  const service = useService(ProposalWorkingService)
  const add = useService(ProposalDeltaAddService)
  const proposal = useService(ProposalService)
  const dimensions = useValue(proposal.dimensions)
  useValue(proposal.names)
  const caption = `${OPERATION_LABEL[delta.operation]} ${KIND_LABEL[delta.kind]} ${delta.targetLabel}`
  const canEdit = editable && !delta.removed && delta.after !== null

  return (
    <Card
      title={(
        <Inline gap={2} wrap>
          <Text weight="semibold">{`${OPERATION_LABEL[delta.operation]} ${KIND_LABEL[delta.kind]}`}</Text>
          {delta.kind === 'rule' ? <ArtifactTag kind="rule" id={delta.targetLabel} /> : <Text tone="muted">{delta.targetLabel}</Text>}
        </Inline>
      )}
      titleLevel={3}
      action={delta.removed ? <Badge tone="bad">removed</Badge> : delta.unpublished ? <Badge tone="warn">unpublished</Badge> : undefined}
    >
      <Stack gap={3}>
        {!delta.removed && <DeltaChanges delta={delta} dimensions={dimensions} name={id => proposal.name(id)} caption={caption} />}
        {delta.removed && <Text size="sm" tone="muted">It leaves the proposal with the next revision.</Text>}
        {editable && (
          <Inline gap={2}>
            {canEdit && <Button size="sm" variant="outline" onClick={() => void add.startEdit(delta)}>Edit</Button>}
            {delta.removed
              ? <Button size="sm" variant="ghost" onClick={() => void service.undoRemove(delta)}>Undo remove</Button>
              : <Button size="sm" variant="ghost" onClick={() => void service.remove(delta)}>Remove</Button>}
          </Inline>
        )}
      </Stack>
    </Card>
  )
}
