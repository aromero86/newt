import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { Avatar } from 'newt-react-ui/avatar'
import { Button } from 'newt-react-ui/button'
import { Card } from 'newt-react-ui/card'
import { Inline } from 'newt-react-ui/inline'
import { PageHeader } from 'newt-react-ui/page-header'
import { Spinner } from 'newt-react-ui/spinner'
import { Stack } from 'newt-react-ui/stack'
import { Text } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import { SessionService } from '../../services/session/session.service'

/** Where auth opens: who is signed in, and signing out. Anyone else signs in first. */
export function Home() {
  const session = useService(SessionService)
  const status = useValue(session.status)
  const user = useValue(session.user)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    void session.check()
  }, [session])

  if (status === 'checking') return <Spinner label="Loading" />
  if (!user) return <Navigate to="/sign-in" replace />

  async function signOut() {
    setSigningOut(true)
    await session.signOut().finally(() => setSigningOut(false))
  }

  return (
    <>
      <PageHeader title="Your Cooper account" description="Cooper's apps sign you in with it." />
      <Card footer={<Button variant="outline" block loading={signingOut} onClick={() => void signOut()}>Sign out</Button>}>
        <Inline gap={3}>
          <Avatar name={user.name} size={9} />
          <Stack gap={1}>
            <Text weight="semibold">{user.name}</Text>
            <Text size="sm" tone="muted">{user.email}</Text>
          </Stack>
        </Inline>
      </Card>
    </>
  )
}
