import { useLocation, useMatch, useSearchParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Card } from 'newt-react-ui/card'
import { Logo } from '@cooper/ui/components/logo'
import { NarrowPage } from 'newt-react-ui/narrow-page'
import { Stack } from 'newt-react-ui/stack'
import { Text } from 'newt-react-ui/text'
import { useService } from 'newt-react'
import { SessionService } from '../../services/session/session.service'
import { SignInInvitation } from './sign-in-invitation/sign-in-invitation'

/**
 * What anyone without a session sees, wherever they arrived: the way to sign in. On
 * an invitation's link, what the invitation is for first.
 */
export function SignIn() {
  const session = useService(SessionService)
  const { pathname } = useLocation()
  const token = useMatch('/invitations/:token')?.params.token
  // boards sends the browser back here with the reason when signing in failed at auth.
  const [params] = useSearchParams()
  const failed = params.get('signInError')
  const signIn = () => session.signIn(pathname)

  return (
    <NarrowPage>
      <Stack align="center">
        <Logo name="Cooper" />
      </Stack>
      {failed && <Alert tone="bad" title="You are not signed in">Signing in did not finish ({failed}). Try again.</Alert>}
      {token
        ? <SignInInvitation token={token} onSignIn={signIn} />
        : (
            <Card
              title="Plan your work in columns and cards"
              titleLevel={2}
              description="Boards for your team: columns for each step, cards for each piece of work, and who does it."
              footer={<Button block onClick={signIn}>Sign in</Button>}
            >
              <Text size="sm" tone="muted">You sign in once, at Cooper's account page, and come back here.</Text>
            </Card>
          )}
    </NarrowPage>
  )
}
