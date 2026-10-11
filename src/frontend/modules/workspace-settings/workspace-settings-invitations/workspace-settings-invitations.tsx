import { MailIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { Text } from '@newt/ui/components/text'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspaceSettingsService } from '../workspace-settings.service'

/** Invitations still waiting for someone to sign up. Admins only. */
export function WorkspaceSettingsInvitations() {
  const settings = useService(WorkspaceSettingsService)
  const invitations = useValue(settings.invitations.items)
  const total = useValue(settings.invitations.total)
  const loaded = useValue(settings.invitations.loaded)
  const hasMore = useValue(settings.invitations.hasMore)
  const loadingMore = useValue(settings.invitations.loadingMore)

  return (
    <Stack gap={4}>
      <Subhead title="Invitations" description="People invited by email who have not signed up yet. Invite someone from Members." />
      <Box label="Pending invitations">
        <BoxHeader>{`${total} pending`}</BoxHeader>
        {loaded && invitations.length === 0 && <BoxEmpty icon={MailIcon} title="No pending invitations" />}
        {invitations.map(invitation => (
          <BoxRow
            key={invitation.id}
            leading={<Icon icon={MailIcon} tone="muted" />}
            trailing={<Button variant="ghost" size="sm" onClick={() => void settings.cancelInvitation(invitation)}>Cancel</Button>}
          >
            <Text size="sm" weight="semibold">{invitation.email}</Text>
            <BoxRowMeta>
              <span>{`invited by @${invitation.invitedByNick}`}</span>
              <span>{'waits until '}<RelativeTime date={invitation.expiresAt} /></span>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void settings.invitations.loadMore()}>Load more</Button></BoxFooter>}
      </Box>
    </Stack>
  )
}
