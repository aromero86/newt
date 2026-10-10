import { MoreHorizontalIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { WorkspaceMemberDTO } from '@newt/api/workspace-member'
import { Avatar } from '@newt/ui/components/avatar'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { Stack } from '@newt/ui/components/stack'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@newt/ui/components/table'
import { Text } from '@newt/ui/components/text'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { SessionService } from '../../../services/session/session.service'
import { WorkspaceSettingsService } from '../workspace-settings.service'
import { WorkspaceSettingsMembersAdd } from './workspace-settings-members-add/workspace-settings-members-add'

/** Who is in the workspace, who was, and (for admins) bringing people in and out. */
export function WorkspaceSettingsMembers({ admin }: { admin: boolean }) {
  const settings = useService(WorkspaceSettingsService)
  const members = useValue(settings.members.items)
  const total = useValue(settings.members.total)
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
    <Card title={`Members (${total})`} titleLevel={2} description="People who left stay listed: what they did here is still theirs.">
      <Stack gap={6}>
        <Table caption="Members of the workspace">
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="end">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map(member => {
              const items = actions(member)
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <Inline gap={2}>
                      <Avatar name={member.fullName} size={7} />
                      <Stack gap={0}>
                        <Text size="sm" weight="medium">{member.fullName}</Text>
                        <Text size="sm" tone="muted">@{member.nick}</Text>
                      </Stack>
                    </Inline>
                  </TableCell>
                  <TableCell><Badge tone={member.role === 'admin' ? 'brand' : 'muted'}>{member.role}</Badge></TableCell>
                  <TableCell>{member.active ? <Text size="sm">Active</Text> : <Badge tone="muted">left</Badge>}</TableCell>
                  <TableCell align="end">
                    {items.length > 0 && (
                      <Menu
                        label={`Actions for @${member.nick}`}
                        align="end"
                        trigger={<Button variant="ghost" size="icon-sm" label={`Actions for @${member.nick}`}><Icon icon={MoreHorizontalIcon} /></Button>}
                        items={items}
                      />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {hasMore && (
          <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void settings.members.loadMore()}>
            Load more members
          </Button>
        )}
        {admin && <WorkspaceSettingsMembersAdd />}
      </Stack>
    </Card>
  )
}
