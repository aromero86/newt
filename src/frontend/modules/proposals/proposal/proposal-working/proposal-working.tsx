import { useEffect, type FormEvent } from 'react'
import { FileTextIcon, PencilIcon } from 'lucide-react'
import type { ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Box, BoxBody, BoxEmpty, BoxHeader } from '@newt/ui/components/box'
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
import { FormField } from '../../../../components/form-field'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { ProposalMergeBox } from '../proposal-merge-box/proposal-merge-box'
import { ProposalWorkingService } from './proposal-working.service'

/** With its own services: whoever renders it needs nothing else. */
export function ProposalWorking({ proposal }: { proposal: ProposalDTO }) {
  return (
    <Provide services={[ProposalWorkingService]}>
      <ProposalWorkingWrapped proposal={proposal} />
    </Provide>
  )
}

/**
 * The working copy: the document as it is being written. Saving keeps it here;
 * publishing a revision reads its deltas and shows both to reviewers.
 */
function ProposalWorkingWrapped({ proposal }: { proposal: ProposalDTO }) {
  const service = useService(ProposalWorkingService)
  const editable = proposal.status === 'draft' || proposal.status === 'in review'

  useEffect(() => {
    service.load()
  }, [service])

  return (
    <Stack gap={6}>
      {editable && proposal.unpublished && proposal.revision > 0 && (
        <Alert tone="warn" title="Unpublished changes">
          <Stack gap={3}>
            <Text size="sm">{`Reviewers still see revision ${proposal.revision}. Publish these changes as a new one, or go back to it.`}</Text>
            {proposal.extraction?.state === 'extracting' && <Text size="sm">{`The deltas of revision ${proposal.revision} are still being extracted: publish once they are ready.`}</Text>}
            <Inline gap={2}>
              <Button size="sm" disabled={proposal.extraction?.state === 'extracting'} onClick={() => service.openPublish()}>{`Publish revision ${proposal.revision + 1}…`}</Button>
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
          : <BoxEmpty icon={FileTextIcon} title="No document yet" description="Context, problem, decisions and open questions. newt reads the deltas from its decisions." action={editable ? <Button size="sm" variant="outline" onClick={() => service.openDocument()}>Write it</Button> : undefined} />}
      </Box>
      {editable && <ProposalMergeBox proposal={proposal} />}
      <ProposalWorkingDocument />
      <ProposalWorkingPublish proposal={proposal} />
    </Stack>
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
  const failure = useValue(service.publishForm.failure)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.publish()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closePublish()} title={`Publish revision ${proposal.revision + 1}`} description="Published at once; newt then extracts the deltas from the document in the background, which can take a few minutes, and reviewers see them when ready. Deltas whose meaning changed go back to pending; the rest keep their verdicts." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Not published">{failure}</Alert>}
          <FormField form={service.publishForm} name="message" label="Message" description="Like a commit: what this revision changes." />
          <Inline justify="end" gap={3}>
            <Button type="submit" loading={publishing}>Publish</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
