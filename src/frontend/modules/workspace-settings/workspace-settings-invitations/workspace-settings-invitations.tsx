import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@newt/ui/components/table'
import { Text } from '@newt/ui/components/text'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspaceSettingsService } from '../workspace-settings.service'

const day = (iso: string) => iso.slice(0, 10)

/** Invitations still waiting for someone to sign up. Admins only. */
export function WorkspaceSettingsInvitations() {
  const settings = useService(WorkspaceSettingsService)
  const invitations = useValue(settings.invitations.items)
  const hasMore = useValue(settings.invitations.hasMore)
  const loadingMore = useValue(settings.invitations.loadingMore)

  return (
    <Card title="Pending invitations" titleLevel={2} description="People invited by email who have not signed up yet.">
      {invitations.length === 0 ? (
        <Text size="sm" tone="muted">None right now.</Text>
      ) : (
        <Table caption="Pending invitations">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Invited by</TableHead>
              <TableHead>Waits until</TableHead>
              <TableHead align="end">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map(invitation => (
              <TableRow key={invitation.id}>
                <TableCell>{invitation.email}</TableCell>
                <TableCell>@{invitation.invitedByNick}</TableCell>
                <TableCell>{day(invitation.expiresAt)}</TableCell>
                <TableCell align="end">
                  <Button variant="ghost" size="sm" onClick={() => void settings.cancelInvitation(invitation)}>Cancel</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {hasMore && (
        <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void settings.invitations.loadMore()}>
          Load more invitations
        </Button>
      )}
    </Card>
  )
}
