import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { MailIcon, SendIcon } from 'lucide-react'
import type { InvitationDTO, InvitationStatus } from '@cooper/api/invitation'
import { Alert } from '@cooper/ui/components/alert'
import { Badge } from '@cooper/ui/components/badge'
import { Box, BoxBody, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { Icon } from '@cooper/ui/components/icon'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Stack } from '@cooper/ui/components/stack'
import { Subhead } from '@cooper/ui/components/subhead'
import { Text } from '@cooper/ui/components/text'
import { FormField } from '@cooper/core/form/form-field'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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
        <span>{'Sent '}<RelativeTime date={invitation.createdAt} /></span>
        {invitation.status === 'pending' && !expired && <span>{'expires '}<RelativeTime date={invitation.expiresAt} /></span>}
      </BoxRowMeta>
    </BoxRow>
  )
}
