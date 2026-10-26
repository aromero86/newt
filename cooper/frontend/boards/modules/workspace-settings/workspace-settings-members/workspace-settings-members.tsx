import { useState } from 'react'
import { UserMinusIcon, UsersIcon } from 'lucide-react'
import type { WorkspaceMemberDTO } from '@cooper/api/workspace-member'
import { Alert } from '@cooper/ui/components/alert'
import { Avatar } from '@cooper/ui/components/avatar'
import { Badge } from '@cooper/ui/components/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { ConfirmDialog } from '@cooper/ui/components/confirm-dialog'
import { Icon } from '@cooper/ui/components/icon'
import { Inline } from '@cooper/ui/components/inline'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Stack } from '@cooper/ui/components/stack'
import { Subhead } from '@cooper/ui/components/subhead'
import { Text } from '@cooper/ui/components/text'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { SessionService } from '../../../services/session/session.service'
import { WorkspaceService } from '../../workspace/workspace.service'

/** Who is in the workspace; its admin takes people out (never themselves). */
export function WorkspaceSettingsMembers({ admin }: { admin: boolean }) {
  const workspace = useService(WorkspaceService)
  const members = useValue(workspace.members)
  const loaded = useValue(workspace.loaded)
  const failure = useValue(workspace.failure)
  const me = useValue(useService(SessionService).user)
  // Who the admin asked to remove, waiting for them to confirm.
  const [removing, setRemoving] = useState<WorkspaceMemberDTO | null>(null)
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!removing) return
    setBusy(true)
    await workspace.remove(removing)
    setBusy(false)
    setRemoving(null)
  }

  return (
    <Stack gap={4}>
      <Subhead
        title="Members"
        description={admin ? 'Everyone in the workspace. Invite more people from Invitations.' : 'Everyone in the workspace. Its admin invites and removes people.'}
      />
      {failure && <Alert tone="bad" title="Could not load the members">{failure}</Alert>}
      <Box label="Members">
        <BoxHeader>{loaded ? `${members.length} ${members.length === 1 ? 'member' : 'members'}` : 'Members'}</BoxHeader>
        {!loaded && !failure && [0, 1].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && members.length === 0 && <BoxEmpty icon={UsersIcon} title="No members" />}
        {members.map(member => (
          <BoxRow
            key={member.id}
            leading={<Avatar name={member.name} size={8} />}
            trailing={(
              <>
                <Badge tone={member.isAdmin ? 'brand' : 'muted'}>{member.isAdmin ? 'admin' : 'member'}</Badge>
                {admin && !member.isAdmin && (
                  <Button variant="ghost" size="icon-sm" label={`Remove ${member.name}`} onClick={() => setRemoving(member)}>
                    <Icon icon={UserMinusIcon} />
                  </Button>
                )}
              </>
            )}
          >
            <Inline gap={2}>
              <Text size="sm" weight="semibold" as="span">{member.name}</Text>
              {member.id === me?.id && <Badge tone="outline">you</Badge>}
            </Inline>
            <BoxRowMeta>{member.email}</BoxRowMeta>
          </BoxRow>
        ))}
      </Box>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={open => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'this member'}?`}
        description="They lose access to the workspace's boards, and their cards are left unassigned."
        confirmLabel="Remove member"
        tone="destructive"
        loading={busy}
        onConfirm={() => void remove()}
      />
    </Stack>
  )
}
