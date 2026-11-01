import { useLocation, useSearchParams } from 'react-router'
import { Alert } from 'newt-kit-react-ui/alert'
import { Button } from 'newt-kit-react-ui/button'
import { Card } from 'newt-kit-react-ui/card'
import { Logo } from '@cooper/ui/components/logo'
import { NarrowPage } from 'newt-kit-react-ui/narrow-page'
import { Stack } from 'newt-kit-react-ui/stack'
import { Text } from 'newt-kit-react-ui/text'
import { useService } from 'newt-kit-react'
import { SessionService } from '../../services/session/session.service'

/**
 * What anyone without a staff session sees, wherever they arrived: the way to sign
 * in, or, signed in as someone who is not of the staff, the way out.
 */
export function SignIn({ refused }: { refused: boolean }) {
  const session = useService(SessionService)
  const { pathname } = useLocation()
  // The backoffice sends the browser back here with the reason when signing in failed at auth.
  const [params] = useSearchParams()
  const failed = params.get('signInError')

  return (
    <NarrowPage>
      <Stack align="center">
        <Logo name="Cooper Backoffice" />
      </Stack>
      {failed && (
        <Alert tone="bad" title="You are not signed in">
          {failed === 'session.sign_in_denied' ? 'Only Cooper\'s staff may sign in to the backoffice.' : `Signing in did not finish (${failed}). Try again.`}
        </Alert>
      )}
      {refused
        ? (
            <Card
              title="This account is not staff"
              titleLevel={2}
              description="The backoffice is only for Cooper's staff. Someone of the staff can give you access."
              footer={<Button block variant="outline" onClick={() => void session.signOut()}>Sign out</Button>}
            />
          )
        : (
            <Card
              title="For Cooper's staff"
              titleLevel={2}
              description="Workspaces, accounts, staff and numbers, in one place."
              footer={<Button block onClick={() => session.signIn(pathname)}>Sign in</Button>}
            >
              <Text size="sm" tone="muted">You sign in at Cooper's account page, and come back here.</Text>
            </Card>
          )}
    </NarrowPage>
  )
}
