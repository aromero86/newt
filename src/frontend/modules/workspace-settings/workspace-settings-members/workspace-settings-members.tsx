import { useNavigate } from 'react-router'
import { MoreHorizontalIcon, UserPlusIcon, UsersIcon } from 'lucide-react'
import type { WorkspaceMemberDTO } from '@newt/api/workspace-member'
import { Avatar } from '@newt/ui/components/avatar'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { SessionService } from '../../../services/session/session.service'
import { WorkspaceSettingsService } from '../workspace-settings.service'
import { WorkspaceSettingsMembersAdd } from './workspace-settings-members-add/workspace-settings-members-add'
import { WorkspaceSettingsMembersAddService } from './workspace-settings-members-add/workspace-settings-members-add.service'

/** With its own WorkspaceSettingsMembersAddService: whoever renders it needs nothing else. */
export function WorkspaceSettingsMembers({ admin }: { admin: boolean }) {
  return (
    <Provide services={[WorkspaceSettingsMembersAddService]}>
      <WorkspaceSettingsMembersWrapped admin={admin} />
    </Provide>
  )
}

/** Who is in the workspace, who was, and (for admins) bringing people in and out. */
function WorkspaceSettingsMembersWrapped({ admin }: { admin: boolean }) {
  const settings = useService(WorkspaceSettingsService)
  const add = useService(WorkspaceSettingsMembersAddService)
  const members = useValue(settings.members.items)
  const total = useValue(settings.members.total)
  const loaded = useValue(settings.members.loaded)
  const hasMore = useValue(settings.members.hasMore)
  const loadingMore = useValue(settings.members.loadingMore)
  const me = useValue(useService(SessionService).user)
  const navigate = useNavigate()

  async function leave() {
    if (await settings.leave()) navigate('/workspaces')
  }

  function actions(member: WorkspaceMemberDTO): MenuItem[] {
    if (member.userId === me?.id) return [{ label: 'Leave the workspace', tone: 'destructive', onSelect: () => void leave() }]
    if (!admin || !member.active) return []
    return [
      member.role === 'admin'
        ? { label: 'Make member', onSelect: () => void settings.changeRole(member, 'member') }
        : { label: 'Make admin', onSelect: () => void settings.changeRole(member, 'admin') },
      { separator: true },
      { label: 'Remove from the workspace', tone: 'destructive', onSelect: () => void settings.remove(member) },
    ]
  }

  return (
    <Stack gap={4}>
      <Subhead
        title="Members"
        description="People who left stay listed: what they did here is still theirs."
        actions={admin && <Button size="sm" onClick={() => add.start()}><Icon icon={UserPlusIcon} size="sm" />Add people</Button>}
      />
      <Box label="Members">
        <BoxHeader>{`${total} ${total === 1 ? 'member' : 'members'}`}</BoxHeader>
        {loaded && members.length === 0 && <BoxEmpty icon={UsersIcon} title="No members" />}
        {members.map(member => {
          const items = actions(member)
          return (
            <BoxRow
              key={member.id}
              leading={<Avatar name={member.fullName} size={8} />}
              trailing={(
                <>
                  <Badge tone={member.role === 'admin' ? 'brand' : 'muted'}>{member.role}</Badge>
                  {!member.active && <Badge tone="muted">left</Badge>}
                  {items.length > 0 && (
                    <Menu
                      label={`Actions for @${member.nick}`}
                      align="end"
                      trigger={<Button variant="ghost" size="icon-sm" label={`Actions for @${member.nick}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                      items={items}
                    />
                  )}
                </>
              )}
            >
              <Inline gap={2}>
                <Text size="sm" weight="semibold" as="span">{member.fullName}</Text>
                {member.userId === me?.id && <Badge tone="outline">you</Badge>}
              </Inline>
              <BoxRowMeta>{`@${member.nick}`}</BoxRowMeta>
            </BoxRow>
          )
        })}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void settings.members.loadMore()}>Load more members</Button></BoxFooter>}
      </Box>
      <WorkspaceSettingsMembersAdd />
    </Stack>
  )
}
