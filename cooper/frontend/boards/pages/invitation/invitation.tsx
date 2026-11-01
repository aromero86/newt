import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { MailXIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Box, BoxEmpty } from 'newt-kit-react-ui/box'
import { Button } from 'newt-kit-react-ui/button'
import { Card } from 'newt-kit-react-ui/card'
import { PageBody } from 'newt-kit-react-ui/page-body'
import { PageHeader } from 'newt-kit-react-ui/page-header'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { Stack } from 'newt-kit-react-ui/stack'
import { Strong, Text } from 'newt-kit-react-ui/text'
import { Provide, useService, useValue } from 'newt-kit-react'
import { SessionService } from '../../services/session/session.service'
import { InvitationService } from './invitation.service'

/** With its own InvitationService: whoever renders it needs nothing else. */
export function Invitation() {
  return (
    <Provide services={[InvitationService]}>
      <InvitationWrapped />
    </Provide>
  )
}

/** `/invitations/:token`: the link of an invitation email, to join a workspace. */
function InvitationWrapped() {
  const token = useParams().token!
  const service = useService(InvitationService)
  const preview = useValue(service.preview)
  const failure = useValue(service.failure)
  const accepting = useValue(service.accepting)
  const acceptFailure = useValue(service.acceptFailure)
  const session = useService(SessionService)
  const user = useValue(session.user)
  const [switching, setSwitching] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    void service.load(token)
  }, [service, token])

  async function accept() {
    const workspaceId = await service.accept()
    if (workspaceId) navigate(`/w/${workspaceId}`)
  }

  // Signed out through auth too, the browser comes back to this link, to sign in as the invited person.
  function switchAccount() {
    setSwitching(true)
    void session.signOut(`/invitations/${token}`)
  }

  const otherEmail = preview && user && preview.email.toLowerCase() !== user.email.toLowerCase()

  return (
    <PageBody width="narrow">
      <Stack gap={6}>
        <PageHeader title="Join a workspace" />
        {failure && (
          <Box label="Invitation">
            <BoxEmpty icon={MailXIcon} title="This invitation cannot be used" description={failure} action={<Button size="sm" variant="outline" href="/">Go to your workspaces</Button>} />
          </Box>
        )}
        {!failure && !preview && <Card><Skeleton lines={3} /></Card>}
        {preview && (
          <Card
            title={preview.workspaceName}
            titleLevel={2}
            description={`${preview.invitedBy} invited ${preview.email} to this workspace.`}
            footer={(
              <>
                {otherEmail
                  ? <Button loading={switching} onClick={switchAccount}>Sign out and switch account</Button>
                  : <Button loading={accepting} onClick={() => void accept()}>Join {preview.workspaceName}</Button>}
                <Button variant="ghost" href="/">Not now</Button>
              </>
            )}
          >
            <Stack gap={3}>
              <Text size="sm" tone="muted">As a member you see its boards, and cards can be assigned to you.</Text>
              {otherEmail && (
                <Alert tone="warn" title="This invitation is for another email">
                  You are signed in as <Strong>{user.email}</Strong>. To join, sign out, then sign in or create an account with <Strong>{preview.email}</Strong>: this link brings you back here.
                </Alert>
              )}
              {acceptFailure && <Alert tone="bad" title="Could not join">{acceptFailure}</Alert>}
            </Stack>
          </Card>
        )}
      </Stack>
    </PageBody>
  )
}
