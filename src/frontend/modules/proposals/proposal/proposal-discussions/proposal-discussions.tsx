import { useEffect, type FormEvent } from 'react'
import type { DiscussionDTO } from '@newt/api/discussion'
import type { DiscussionCommentDTO } from '@newt/api/discussion-comment'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Inline } from '@newt/ui/components/inline'
import { Markdown } from '@newt/ui/components/markdown'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../../components/form-field'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { SessionService } from '../../../../services/session/session.service'
import { ProposalService } from '../proposal.service'
import { ProposalDiscussionService } from './proposal-discussion.service'
import { ProposalDiscussionsService } from './proposal-discussions.service'

type ProposalDiscussionsProps = {
  /** The conversations on this delta; without it, on the proposal in general. */
  deltaId?: string
  readOnly: boolean
}

/** With its own ProposalDiscussionsService: whoever renders it needs nothing else. */
export function ProposalDiscussions(props: ProposalDiscussionsProps) {
  return (
    <Provide services={[ProposalDiscussionsService]}>
      <ProposalDiscussionsWrapped {...props} />
    </Provide>
  )
}

/** The conversations, page by page, and starting a new one. */
function ProposalDiscussionsWrapped({ deltaId, readOnly }: ProposalDiscussionsProps) {
  const service = useService(ProposalDiscussionsService)
  const discussions = useValue(service.discussions.items)
  const loaded = useValue(service.discussions.loaded)
  const hasMore = useValue(service.discussions.hasMore)
  const loadingMore = useValue(service.discussions.loadingMore)
  const submitting = useValue(service.form.submitting)

  useEffect(() => {
    void service.load(deltaId)
  }, [service, deltaId])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.start()
  }

  return (
    <Stack gap={4}>
      {loaded && discussions.length === 0 && <Text size="sm" tone="muted">No conversations yet.</Text>}
      {discussions.map(discussion => <ProposalDiscussion key={discussion.id} discussion={discussion} readOnly={readOnly} />)}
      {hasMore && (
        <Inline>
          <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.discussions.loadMore()}>Load more conversations</Button>
        </Inline>
      )}
      {!readOnly && (
        <form onSubmit={onSubmit} noValidate>
          <Stack gap={3} align="start">
            <FormField form={service.form} name="body" label={deltaId ? 'Comment on this delta' : 'Comment on the proposal'} description="Markdown works." rows={3} />
            <Button type="submit" size="sm" variant="secondary" loading={submitting}>Start a conversation</Button>
          </Stack>
        </form>
      )}
    </Stack>
  )
}

/** With its own ProposalDiscussionService. */
function ProposalDiscussion(props: { discussion: DiscussionDTO, readOnly: boolean }) {
  return (
    <Provide services={[ProposalDiscussionService]}>
      <ProposalDiscussionWrapped {...props} />
    </Provide>
  )
}

/** One conversation: its first comment and, opened, the rest and a reply. */
function ProposalDiscussionWrapped({ discussion, readOnly }: { discussion: DiscussionDTO, readOnly: boolean }) {
  const service = useService(ProposalDiscussionService)
  const discussions = useService(ProposalDiscussionsService)
  const proposal = useValue(useService(ProposalService).proposal)
  const open = useValue(service.open)
  const comments = useValue(service.comments.items)
  const hasMore = useValue(service.comments.hasMore)
  const loadingMore = useValue(service.comments.loadingMore)
  const submitting = useValue(service.replyForm.submitting)
  const resolved = discussion.resolvedAt !== null
  const replies = discussion.comments - 1

  function onReply(event: FormEvent) {
    event.preventDefault()
    void service.reply()
  }

  return (
    <Stack gap={2}>
      <Inline gap={2} wrap>
        <Text size="sm" weight="semibold">{`@${discussion.startedBy.nick}`}</Text>
        {proposal && discussion.revision < proposal.revision && <Badge tone="outline">{`about revision ${discussion.revision}`}</Badge>}
        {resolved && <Badge tone="ok">{`resolved by @${discussion.resolvedBy!.nick}`}</Badge>}
      </Inline>
      {open
        ? (
            <Stack gap={3}>
              {comments.map(comment => <ProposalComment key={comment.id} comment={comment} readOnly={readOnly} />)}
              {hasMore && <Inline><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.comments.loadMore()}>Load more comments</Button></Inline>}
              {!readOnly && (
                <form onSubmit={onReply} noValidate>
                  <Stack gap={2} align="start">
                    <FormField form={service.replyForm} name="body" label="Reply" rows={2} />
                    <Button type="submit" size="sm" variant="secondary" loading={submitting}>Reply</Button>
                  </Stack>
                </form>
              )}
            </Stack>
          )
        : <Markdown>{discussion.first.body}</Markdown>}
      <Inline gap={2} wrap>
        {open
          ? <Button size="sm" variant="ghost" onClick={() => service.collapse()}>Close</Button>
          : <Button size="sm" variant="ghost" onClick={() => void service.expand(discussion.id)}>{replies > 0 ? `Open (${replies} ${replies === 1 ? 'reply' : 'replies'})` : 'Reply'}</Button>}
        {!readOnly && (resolved
          ? <Button size="sm" variant="ghost" onClick={() => void discussions.reopen(discussion)}>Reopen</Button>
          : <Button size="sm" variant="ghost" onClick={() => void discussions.resolveDiscussion(discussion)}>Resolve</Button>)}
      </Inline>
    </Stack>
  )
}

/** One comment: its author, when, and what they said; its author edits it. */
function ProposalComment({ comment, readOnly }: { comment: DiscussionCommentDTO, readOnly: boolean }) {
  const service = useService(ProposalDiscussionService)
  const editing = useValue(service.editing)
  const saving = useValue(service.editForm.submitting)
  const me = useValue(useService(SessionService).user)

  function onSave(event: FormEvent) {
    event.preventDefault()
    void service.saveEdit()
  }

  return (
    <Stack gap={1}>
      <Inline gap={2} wrap>
        <Text size="sm" weight="medium">{`@${comment.author.nick}`}</Text>
        <Text size="sm" tone="muted">{new Date(comment.createdAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
        {comment.editedAt && <Text size="sm" tone="muted">edited</Text>}
        {!readOnly && comment.author.id === me?.id && editing !== comment.id && (
          <Button size="sm" variant="ghost" onClick={() => service.startEdit(comment)}>Edit</Button>
        )}
      </Inline>
      {editing === comment.id
        ? (
            <form onSubmit={onSave} noValidate>
              <Stack gap={2} align="start">
                <FormField form={service.editForm} name="body" label="Edit your comment" rows={3} />
                <Inline gap={2}>
                  <Button type="submit" size="sm" loading={saving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => service.cancelEdit()}>Cancel</Button>
                </Inline>
              </Stack>
            </form>
          )
        : <Markdown>{comment.body}</Markdown>}
    </Stack>
  )
}
