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
              title="Cooper's backoffice"
              titleLevel={2}
              description="Workspaces, accounts, staff and numbers, for Cooper's staff."
              footer={<Button block onClick={() => session.signIn(pathname)}>Sign in</Button>}
            >
              <Text size="sm" tone="muted">You sign in at Cooper's account page, and come back here.</Text>
            </Card>
          )}
    </NarrowPage>
  )
}
