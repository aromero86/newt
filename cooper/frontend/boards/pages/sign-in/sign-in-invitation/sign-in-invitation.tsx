import { useEffect } from 'react'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { Card } from '@newt-kit/react-ui/card'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { Strong, Text } from '@newt-kit/react-ui/text'
import { Provide, useService, useValue } from '@newt-kit/react'
import { SignInInvitationService } from './sign-in-invitation.service'

type SignInInvitationProps = {
  token: string
  onSignIn: () => void
}

/** With its own SignInInvitationService: whoever renders it needs nothing else. */
export function SignInInvitation(props: SignInInvitationProps) {
  return (
    <Provide services={[SignInInvitationService]}>
      <SignInInvitationWrapped {...props} />
    </Provide>
  )
}

/** An invitation opened before signing in: what it is for, and signing in with the invited email to join. */
function SignInInvitationWrapped({ token, onSignIn }: SignInInvitationProps) {
  const service = useService(SignInInvitationService)
  const preview = useValue(service.preview)
  const failure = useValue(service.failure)

  useEffect(() => {
    void service.load(token)
  }, [service, token])

  const signIn = <Button block onClick={onSignIn}>Sign in to join</Button>

  if (failure) {
    return (
      <Card title="This invitation cannot be used" titleLevel={2} footer={<Button block variant="outline" onClick={onSignIn}>Sign in to Cooper</Button>}>
        <Alert tone="warn" title="The link does not open a workspace">{failure}</Alert>
      </Card>
    )
  }
  if (!preview) return <Card><Skeleton lines={3} /></Card>

  return (
    <Card title={`Join ${preview.workspaceName} on Cooper`} titleLevel={2} description={`${preview.invitedBy} invited you to this workspace.`} footer={signIn}>
      <Stack gap={3}>
        <Text size="sm" tone="muted">
          The invitation is for <Strong>{preview.email}</Strong>. Sign in with that email, or create an account with it, and you join right after.
        </Text>
        <Text size="sm" tone="muted">As a member you see its boards, and cards can be assigned to you.</Text>
      </Stack>
    </Card>
  )
}
