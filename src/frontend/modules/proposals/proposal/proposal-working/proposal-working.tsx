import { useEffect, type FormEvent } from 'react'
import { FileTextIcon, PencilIcon, PlusIcon } from 'lucide-react'
import type { DeltaDTO, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxEmpty, BoxFooter, BoxHeader, BoxRow } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Field } from '@newt/ui/components/field'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Markdown } from '@newt/ui/components/markdown'
import { Stack } from '@newt/ui/components/stack'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@newt/ui/components/tabs'
import { Text } from '@newt/ui/components/text'
import { Textarea } from '@newt/ui/components/textarea'
import { DeltaChanges } from '../../../../components/delta-changes'
import { FormField } from '../../../../components/form-field'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { ProposalDeltaAdd } from '../proposal-delta-add/proposal-delta-add'
import { ProposalDeltaAddService } from '../proposal-delta-add/proposal-delta-add.service'
import { DeltaTitle, KIND_LABEL, OPERATION_LABEL } from '../../../../components/delta-title'
import { ProposalMergeBox } from '../proposal-merge-box/proposal-merge-box'
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
  const deltas = useValue(service.deltas.items)
  const loaded = useValue(service.deltas.loaded)
  const hasMore = useValue(service.deltas.hasMore)
  const loadingMore = useValue(service.deltas.loadingMore)
  const editable = proposal.status === 'draft' || proposal.status === 'in review'

  useEffect(() => {
    void service.load()
  }, [service])

  return (
    <Stack gap={6}>
      {editable && proposal.unpublished && proposal.revision > 0 && (
        <Alert tone="warn" title="Unpublished changes">
          <Stack gap={3}>
            <Text size="sm">{`Reviewers still see revision ${proposal.revision}. Publish these changes as a new one, or go back to it.`}</Text>
            <Inline gap={2}>
              <Button size="sm" onClick={() => service.openPublish()}>{`Publish revision ${proposal.revision + 1}…`}</Button>
              <Button size="sm" variant="ghost" onClick={() => void service.discard()}>Discard changes</Button>
            </Inline>
          </Stack>
        </Alert>
      )}
      {!editable && <Alert tone="info" title="The working copy is frozen">{`The proposal is ${proposal.status}: it takes no more changes.`}</Alert>}
      <Box label="Document">
        <BoxHeader actions={editable && <Button size="sm" variant="ghost" onClick={() => service.openDocument()}><Icon icon={PencilIcon} size="sm" />Edit</Button>}>
          <Inline gap={2}><Icon icon={FileTextIcon} size="sm" tone="muted" />Document</Inline>
        </BoxHeader>
        {proposal.document
          ? <BoxBody><Markdown>{proposal.document}</Markdown></BoxBody>
          : <BoxEmpty icon={FileTextIcon} title="No document yet" description="Context, problem, decisions and open questions: what the deltas alone do not say." action={editable ? <Button size="sm" variant="outline" onClick={() => service.openDocument()}>Write it</Button> : undefined} />}
      </Box>
      <Box label="Deltas in the working copy">
        <BoxHeader actions={editable && <Button size="sm" onClick={() => add.start()}><Icon icon={PlusIcon} size="sm" />Add a delta</Button>}>
          {`${deltas.length}${hasMore ? '+' : ''} ${deltas.length === 1 ? 'delta' : 'deltas'}`}
        </BoxHeader>
        {loaded && deltas.length === 0 && <BoxEmpty title="No deltas yet" description="Each one is a change to one artifact of the definition." />}
        {deltas.map(delta => <ProposalWorkingDelta key={delta.id} delta={delta} editable={editable} />)}
        {hasMore && <BoxFooter><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.deltas.loadMore()}>Load more deltas</Button></BoxFooter>}
      </Box>
      {editable && <ProposalMergeBox proposal={proposal} />}
      <ProposalDeltaAdd />
      <ProposalWorkingDocument />
      <ProposalWorkingPublish proposal={proposal} />
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
    <BoxRow
      trailing={(
        <>
          {delta.removed ? <Badge tone="bad">removed</Badge> : delta.unpublished ? <Badge tone="warn">unpublished</Badge> : undefined}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => void add.startEdit(delta)}>Edit</Button>}
          {editable && (delta.removed
            ? <Button size="sm" variant="ghost" onClick={() => void service.undoRemove(delta)}>Undo</Button>
            : <Button size="sm" variant="ghost" onClick={() => void service.remove(delta)}>Remove</Button>)}
        </>
      )}
    >
      <Stack gap={3}>
        <DeltaTitle delta={delta} />
        {!delta.removed && <DeltaChanges delta={delta} dimensions={dimensions} name={id => proposal.name(id)} caption={caption} />}
        {delta.removed && <Text size="sm" tone="muted">It leaves the proposal with the next revision.</Text>}
      </Stack>
    </BoxRow>
  )
}

/** The document, written in Markdown with a preview; saving keeps it in the working copy. */
function ProposalWorkingDocument() {
  const service = useService(ProposalWorkingService)
  const open = useValue(service.editingDocument)
  const draft = useValue(service.draft)
  const saving = useValue(service.saving)

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closeDocument()} title="Edit the document" description="Saved in the working copy: reviewers see it once a revision publishes it." size="lg">
      <Stack gap={4}>
        <Tabs defaultValue="write" variant="underline">
          <TabsList label="Document">
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Field label="Document" description="Markdown: titles, lists, quotes, code.">
              <Textarea value={draft} rows={16} onChange={value => service.type(value)} />
            </Field>
          </TabsContent>
          <TabsContent value="preview">
            {draft ? <Markdown>{draft}</Markdown> : <Text size="sm" tone="muted">Nothing written yet.</Text>}
          </TabsContent>
        </Tabs>
        <Inline justify="end" gap={2}>
          <Button variant="ghost" onClick={() => service.closeDocument()}>Cancel</Button>
          <Button loading={saving} onClick={() => void service.saveDocument()}>Save</Button>
        </Inline>
      </Stack>
    </Dialog>
  )
}

/** Publishing a revision: its message, like a commit's. */
function ProposalWorkingPublish({ proposal }: { proposal: ProposalDTO }) {
  const service = useService(ProposalWorkingService)
  const open = useValue(service.publishing)
  const publishing = useValue(service.publishForm.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.publish()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closePublish()} title={`Publish revision ${proposal.revision + 1}`} description="Reviewers see it at once. Deltas that changed go back to pending; the rest keep their verdicts." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.publishForm} name="message" label="Message" description="Like a commit: what this revision changes." />
          <Inline justify="end"><Button type="submit" loading={publishing}>Publish</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
