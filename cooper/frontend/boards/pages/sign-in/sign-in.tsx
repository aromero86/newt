import { useLocation, useSearchParams } from 'react-router'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { Card } from '@cooper/ui/components/card'
import { Logo } from '@cooper/ui/components/logo'
import { NarrowPage } from '@cooper/ui/components/narrow-page'
import { Stack } from '@cooper/ui/components/stack'
import { Text } from '@cooper/ui/components/text'
import { useService } from '@cooper/core/injector/use-service'
import { SessionService } from '../../services/session/session.service'

/** What anyone without a session sees, wherever they arrived: the way to sign in. */
export function SignIn() {
  const session = useService(SessionService)
  const { pathname } = useLocation()
  // boards sends the browser back here with the reason when signing in failed at auth.
  const [params] = useSearchParams()
  const failed = params.get('signInError')
  const invited = pathname.startsWith('/invitations/')

  return (
    <NarrowPage>
      <Stack align="center">
        <Logo name="Cooper" />
      </Stack>
      {failed && <Alert tone="bad" title="You are not signed in">Signing in did not finish ({failed}). Try again.</Alert>}
      <Card
        title={invited ? 'You are invited to a workspace' : 'Plan your work in columns and cards'}
        titleLevel={2}
        description={invited
          ? 'Sign in with the email the invitation was sent to, or create an account with it, to join.'
          : 'Boards for your team: columns for each step, cards for each piece of work, and who does it.'}
        footer={<Button block onClick={() => session.signIn(pathname)}>Sign in</Button>}
      >
        <Text size="sm" tone="muted">You sign in once, at Cooper's account page, and come back here.</Text>
      </Card>
    </NarrowPage>
  )
}
