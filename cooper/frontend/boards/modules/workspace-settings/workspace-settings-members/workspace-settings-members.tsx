import { useState } from 'react'
import { useNavigate } from 'react-router'
import { LogOutIcon, UserMinusIcon, UsersIcon } from 'lucide-react'
import type { WorkspaceMemberDTO } from '@cooper/api/workspace-member'
import { Alert } from '@newt-kit/react-ui/alert'
import { Avatar } from '@newt-kit/react-ui/avatar'
import { Badge } from '@newt-kit/react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'
import { ConfirmDialog } from '@newt-kit/react-ui/confirm-dialog'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { Subhead } from '@newt-kit/react-ui/subhead'
import { Text } from '@newt-kit/react-ui/text'
import { useService, useValue } from '@newt-kit/react'
import { SessionService } from '../../../services/session/session.service'
import { WorkspaceService } from '../../workspace/workspace.service'

/** Who is in the workspace; its admin takes people out (never themselves), and anyone else may leave. */
export function WorkspaceSettingsMembers({ admin }: { admin: boolean }) {
  const workspace = useService(WorkspaceService)
  const members = useValue(workspace.members)
  const loaded = useValue(workspace.loaded)
  const failure = useValue(workspace.failure)
  const me = useValue(useService(SessionService).user)
  // Who the admin asked to remove, waiting for them to confirm.
  const [removing, setRemoving] = useState<WorkspaceMemberDTO | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const navigate = useNavigate()

  async function remove() {
    if (!removing) return
    setBusy(true)
    await workspace.remove(removing)
    setBusy(false)
    setRemoving(null)
  }

  async function leave() {
    setBusy(true)
    const left = await workspace.leave()
    setBusy(false)
    setConfirmingLeave(false)
    if (!left) return
    // Away first: the workspace's pages would say it is not found once it is forgotten.
    navigate('/', { replace: true })
    workspace.forgetLeft()
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
            leading={<Avatar name={member.name} src={member.avatarUrl} size={8} />}
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
      {!admin && (
        <Stack gap={0}>
          <Subhead title="Leave" tone="danger" />
          <Box label="Leave the workspace">
            <BoxRow trailing={<Button size="sm" variant="destructive" onClick={() => setConfirmingLeave(true)}><Icon icon={LogOutIcon} size="sm" />Leave workspace</Button>}>
              <Text size="sm" weight="semibold">Leave this workspace</Text>
              <Text size="sm" tone="muted">You no longer see its boards, and your cards in it are left unassigned. Its admin can invite you again.</Text>
            </BoxRow>
          </Box>
        </Stack>
      )}
      <ConfirmDialog
        open={confirmingLeave}
        onOpenChange={open => !open && setConfirmingLeave(false)}
        title="Leave this workspace?"
        description="You lose access to its boards, and your cards in it are left unassigned."
        confirmLabel="Leave workspace"
        tone="destructive"
        loading={busy}
        onConfirm={() => void leave()}
      />
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
