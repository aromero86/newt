import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { MailIcon, SendIcon } from 'lucide-react'
import type { InvitationDTO, InvitationStatus } from '@cooper/api/invitation'
import { Alert } from 'newt-kit-react-ui/alert'
import { Badge } from 'newt-kit-react-ui/badge'
import { Box, BoxBody, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from 'newt-kit-react-ui/box'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { RelativeTime } from 'newt-kit-react-ui/relative-time'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Stack } from 'newt-kit-react-ui/stack'
import { Subhead } from 'newt-kit-react-ui/subhead'
import { Text } from 'newt-kit-react-ui/text'
import { FormField } from 'newt-kit-react/form-field'
import { Provide, useService, useValue } from 'newt-kit-react'
import { WorkspaceSettingsInvitationsService } from './workspace-settings-invitations.service'

const statusTone: Record<InvitationStatus, 'info' | 'ok' | 'muted'> = { pending: 'info', accepted: 'ok', revoked: 'muted' }

/** With its own WorkspaceSettingsInvitationsService: whoever renders it needs nothing else. */
export function WorkspaceSettingsInvitations() {
  return (
    <Provide services={[WorkspaceSettingsInvitationsService]}>
      <WorkspaceSettingsInvitationsWrapped />
    </Provide>
  )
}

/** Inviting people by email, and the invitations sent. Its admin's only. */
function WorkspaceSettingsInvitationsWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(WorkspaceSettingsInvitationsService)
  const items = useValue(service.items)
  const loaded = useValue(service.loaded)
  const failure = useValue(service.failure)
  const submitting = useValue(service.form.submitting)
  const formFailure = useValue(service.form.failure)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.invite()
  }

  const pending = items.filter(invitation => invitation.status === 'pending').length

  return (
    <Stack gap={4}>
      <Subhead title="Invitations" description="Each invitation sends a link by email. Whoever signs in with that email can join with it." />
      <Box label="Invite someone">
        <BoxBody>
          <form onSubmit={onSubmit} noValidate>
            <Stack gap={3} align="start">
              {formFailure && <Alert tone="bad" title="Could not invite">{formFailure}</Alert>}
              <FormField form={service.form} name="email" label="Email" type="email" autoComplete="off" placeholder="someone@example.com" />
              <Button type="submit" loading={submitting}><Icon icon={SendIcon} size="sm" />Send invitation</Button>
            </Stack>
          </form>
        </BoxBody>
      </Box>
      {failure && <Alert tone="bad" title="Could not load the invitations">{failure}</Alert>}
      <Box label="Invitations sent">
        <BoxHeader>{loaded ? `${pending} pending` : 'Invitations'}</BoxHeader>
        {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
        {loaded && items.length === 0 && <BoxEmpty icon={MailIcon} title="No invitations yet" description="Invite the people you work with by their email." />}
        {items.map(invitation => <WorkspaceSettingsInvitationsRow key={invitation.id} invitation={invitation} onRevoke={() => void service.revoke(invitation)} />)}
      </Box>
    </Stack>
  )
}

function WorkspaceSettingsInvitationsRow({ invitation, onRevoke }: { invitation: InvitationDTO, onRevoke: () => void }) {
  const expired = invitation.status === 'pending' && new Date(invitation.expiresAt).getTime() < Date.now()
  return (
    <BoxRow
      leading={<Icon icon={MailIcon} tone="muted" />}
      trailing={(
        <>
          <Badge tone={expired ? 'warn' : statusTone[invitation.status]}>{expired ? 'expired' : invitation.status}</Badge>
          {invitation.status === 'pending' && <Button variant="ghost" size="sm" onClick={onRevoke}>Revoke</Button>}
        </>
      )}
    >
      <Text size="sm" weight="semibold">{invitation.email}</Text>
      <BoxRowMeta>
        <>{'Sent '}<RelativeTime date={invitation.createdAt} /></>
        {invitation.status === 'pending' && !expired && <>{'expires '}<RelativeTime date={invitation.expiresAt} /></>}
      </BoxRowMeta>
    </BoxRow>
  )
}
