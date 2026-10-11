import { useEffect, type FormEvent } from 'react'
import type { DiscussionDTO } from '@newt/api/discussion'
import type { DiscussionCommentDTO } from '@newt/api/discussion-comment'
import { Avatar } from '@newt/ui/components/avatar'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxFooter, BoxHeader } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Inline } from '@newt/ui/components/inline'
import { Markdown } from '@newt/ui/components/markdown'
import { RelativeTime } from '@newt/ui/components/relative-time'
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

/** The conversations, page by page, and a box to start a new one, like a pull request's comments. */
function ProposalDiscussionsWrapped({ deltaId, readOnly }: ProposalDiscussionsProps) {
  const service = useService(ProposalDiscussionsService)
  const discussions = useValue(service.discussions.items)
  const loaded = useValue(service.discussions.loaded)
  const hasMore = useValue(service.discussions.hasMore)
  const loadingMore = useValue(service.discussions.loadingMore)
  const submitting = useValue(service.form.submitting)
  const me = useValue(useService(SessionService).user)

  useEffect(() => {
    void service.load(deltaId)
  }, [service, deltaId])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.start()
  }

  return (
    <Stack gap={4}>
      {loaded && discussions.length === 0 && deltaId && <Text size="sm" tone="muted">No conversations on this delta yet.</Text>}
      {discussions.map(discussion => <ProposalDiscussion key={discussion.id} discussion={discussion} readOnly={readOnly} />)}
      {hasMore && (
        <Inline>
          <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.discussions.loadMore()}>Load more conversations</Button>
        </Inline>
      )}
      {!readOnly && (
        <Box label={deltaId ? 'Comment on this delta' : 'Comment on the proposal'}>
          <BoxHeader>
            <Inline gap={2}>
              {me && <Avatar name={me.fullName} size={5} />}
              <Text size="sm" weight="medium" as="span">{deltaId ? 'Comment on this delta' : 'Add a comment'}</Text>
            </Inline>
          </BoxHeader>
          <BoxBody>
            <form onSubmit={onSubmit} noValidate>
              <Stack gap={3}>
                <FormField form={service.form} name="body" label="Comment" description="Markdown works." rows={3} />
                <Inline justify="end"><Button type="submit" size="sm" loading={submitting}>Comment</Button></Inline>
              </Stack>
            </form>
          </BoxBody>
        </Box>
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

/** One conversation: its first comment and, opened, the replies and a box to answer. */
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
    <Box label={`Conversation started by @${discussion.startedBy.nick}`}>
      <BoxHeader
        actions={(
          <>
            {proposal && discussion.revision < proposal.revision && <Badge tone="outline">{`about revision ${discussion.revision}`}</Badge>}
            {resolved && <Badge tone="ok">{`resolved by @${discussion.resolvedBy!.nick}`}</Badge>}
            {!readOnly && (resolved
              ? <Button size="sm" variant="ghost" onClick={() => void discussions.reopen(discussion)}>Reopen</Button>
              : <Button size="sm" variant="ghost" onClick={() => void discussions.resolveDiscussion(discussion)}>Resolve</Button>)}
          </>
        )}
      >
        <CommentAuthor nick={discussion.first.author.nick} at={discussion.first.createdAt} edited={discussion.first.editedAt !== null} />
      </BoxHeader>
      {open
        ? (
            <>
              {comments.map((comment, index) => (
                index === 0
                  ? <BoxBody key={comment.id}><ProposalCommentBody comment={comment} readOnly={readOnly} /></BoxBody>
                  : <BoxBody key={comment.id}><ProposalComment comment={comment} readOnly={readOnly} /></BoxBody>
              ))}
              {hasMore && <BoxFooter><Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.comments.loadMore()}>Load more comments</Button></BoxFooter>}
              {!readOnly && (
                <BoxBody>
                  <form onSubmit={onReply} noValidate>
                    <Stack gap={2}>
                      <FormField form={service.replyForm} name="body" label="Reply" rows={2} />
                      <Inline justify="end" gap={2}>
                        <Button size="sm" variant="ghost" onClick={() => service.collapse()}>Close</Button>
                        <Button type="submit" size="sm" loading={submitting}>Reply</Button>
                      </Inline>
                    </Stack>
                  </form>
                </BoxBody>
              )}
            </>
          )
        : (
            <>
              <BoxBody><Markdown>{discussion.first.body}</Markdown></BoxBody>
              <BoxFooter justify="start">
                <Button size="sm" variant="ghost" onClick={() => void service.expand(discussion.id)}>
                  {replies > 0 ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'Reply'}
                </Button>
              </BoxFooter>
            </>
          )}
    </Box>
  )
}

/** Who wrote a comment, and when. */
function CommentAuthor({ nick, at, edited }: { nick: string, at: string, edited: boolean }) {
  return (
    <Inline gap={2}>
      <Avatar name={nick} size={5} />
      <Text size="sm" weight="semibold" as="span">{`@${nick}`}</Text>
      <Text size="sm" tone="muted" as="span"><RelativeTime date={at} />{edited ? ' · edited' : ''}</Text>
    </Inline>
  )
}

/** A reply: its author, and what they said. */
function ProposalComment({ comment, readOnly }: { comment: DiscussionCommentDTO, readOnly: boolean }) {
  return (
    <Stack gap={2}>
      <CommentAuthor nick={comment.author.nick} at={comment.createdAt} edited={comment.editedAt !== null} />
      <ProposalCommentBody comment={comment} readOnly={readOnly} />
    </Stack>
  )
}

/** What a comment says; its author edits it in place. */
function ProposalCommentBody({ comment, readOnly }: { comment: DiscussionCommentDTO, readOnly: boolean }) {
  const service = useService(ProposalDiscussionService)
  const editing = useValue(service.editing)
  const saving = useValue(service.editForm.submitting)
  const me = useValue(useService(SessionService).user)

  function onSave(event: FormEvent) {
    event.preventDefault()
    void service.saveEdit()
  }

  if (editing === comment.id) {
    return (
      <form onSubmit={onSave} noValidate>
        <Stack gap={2}>
          <FormField form={service.editForm} name="body" label="Edit your comment" rows={3} />
          <Inline justify="end" gap={2}>
            <Button size="sm" variant="ghost" onClick={() => service.cancelEdit()}>Cancel</Button>
            <Button type="submit" size="sm" loading={saving}>Save</Button>
          </Inline>
        </Stack>
      </form>
    )
  }
  return (
    <Stack gap={1}>
      <Markdown>{comment.body}</Markdown>
      {!readOnly && comment.author.id === me?.id && (
        <Inline><Button size="sm" variant="ghost" onClick={() => service.startEdit(comment)}>Edit</Button></Inline>
      )}
    </Stack>
  )
}
