import { useEffect, useState } from 'react'
import { ShieldCheckIcon, UserMinusIcon } from 'lucide-react'
import type { StaffMemberDTO } from '@cooper/api/backoffice-staff'
import { Alert } from '@newt-kit/react-ui/alert'
import { Avatar } from '@newt-kit/react-ui/avatar'
import { Badge } from '@newt-kit/react-ui/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'
import { ConfirmDialog } from '@newt-kit/react-ui/confirm-dialog'
import { Counter } from '@newt-kit/react-ui/counter'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { PageHeader } from '@newt-kit/react-ui/page-header'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { toast } from '@newt-kit/react-ui/toast'
import { Provide, useService, useValue } from '@newt-kit/react'
import { SessionService } from '../../services/session/session.service'
import { StaffGrant } from './staff-grant'
import { StaffService } from './staff.service'

/** Who may use the backoffice: the staff, adding one, and taking one out. With its own StaffService. */
export function Staff() {
  return (
    <Provide services={[StaffService]}>
      <StaffWrapped />
    </Provide>
  )
}

function StaffWrapped() {
  const staff = useService(StaffService)
  const me = useValue(useService(SessionService).user)
  const items = useValue(staff.list.items)
  const total = useValue(staff.list.total)
  const loaded = useValue(staff.list.loaded)
  const hasMore = useValue(staff.list.hasMore)
  const loadingMore = useValue(staff.list.loadingMore)
  const failure = useValue(staff.list.failure)
  // Who is to leave the staff, waiting for the confirmation.
  const [revoking, setRevoking] = useState<StaffMemberDTO | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void staff.load()
  }, [staff])

  async function revoke() {
    if (!revoking) return
    setBusy(true)
    const problem = await staff.revoke(revoking)
    setBusy(false)
    setRevoking(null)
    if (problem) toast.error(problem)
    else toast.success(`${revoking.name} is no longer staff`)
  }

  return (
    <Stack gap={6}>
      <PageHeader title="Staff" description="Who may use the backoffice. Taking someone's access away counts at once." />
      <StaffGrant />
      {failure && <Alert tone="bad" title="Could not load the staff">{failure}</Alert>}
      <Box label="Staff">
        <BoxHeader>Staff {loaded && <Counter>{total}</Counter>}</BoxHeader>
        {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
        {loaded && items.length === 0 && <BoxEmpty icon={ShieldCheckIcon} title="No staff" />}
        {items.map(member => (
          <BoxRow
            key={member.id}
            leading={<Avatar name={member.name} size={8} />}
            trailing={member.userId !== me?.id && (
              <Button variant="ghost" size="icon-sm" label={`Take ${member.name} out of the staff`} onClick={() => setRevoking(member)}>
                <Icon icon={UserMinusIcon} />
              </Button>
            )}
          >
            <Inline gap={2}>
              <BoxRowTitle href={`/users/${member.userId}`}>{member.name}</BoxRowTitle>
              {member.userId === me?.id && <Badge tone="outline">you</Badge>}
            </Inline>
            <BoxRowMeta>
              <>{member.email}</>
              <>staff since <RelativeTime date={member.since} /></>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && (
          <BoxFooter>
            <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void staff.list.loadMore()}>Load more</Button>
          </BoxFooter>
        )}
      </Box>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={open => !open && setRevoking(null)}
        title={`Take ${revoking?.name ?? 'them'} out of the staff?`}
        description="They can no longer use the backoffice, from their next request on. Their Cooper account stays."
        confirmLabel="Take out"
        tone="destructive"
        loading={busy}
        onConfirm={() => void revoke()}
      />
    </Stack>
  )
}
