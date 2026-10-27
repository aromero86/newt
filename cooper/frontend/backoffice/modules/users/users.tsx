import { useEffect } from 'react'
import { UsersIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Avatar } from 'newt-react-ui/avatar'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Counter } from 'newt-react-ui/counter'
import { PageHeader } from 'newt-react-ui/page-header'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { SearchField } from 'newt-react-ui/search-field'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Provide, useService, useValue } from 'newt-react'
import { UsersService } from './users.service'

/** Every account of cooper, with a search by email or name. With its own UsersService. */
export function Users() {
  return (
    <Provide services={[UsersService]}>
      <UsersWrapped />
    </Provide>
  )
}

function UsersWrapped() {
  const users = useService(UsersService)
  const text = useValue(users.text)
  const items = useValue(users.list.items)
  const total = useValue(users.list.total)
  const loaded = useValue(users.list.loaded)
  const loading = useValue(users.list.loading)
  const hasMore = useValue(users.list.hasMore)
  const loadingMore = useValue(users.list.loadingMore)
  const failure = useValue(users.list.failure)

  useEffect(() => {
    void users.load()
  }, [users])

  return (
    <Stack gap={4}>
      <PageHeader title="Users" description="Every account of Cooper, the newest first. Staff are marked." />
      <SearchField label="Search users" placeholder="An email or a whole name" defaultValue={text} onSearch={query => void users.search(query)} />
      {failure && <Alert tone="bad" title="Could not load the users">{failure}</Alert>}
      <Box label="Users">
        <BoxHeader actions={text ? <Button size="sm" variant="ghost" onClick={() => void users.search('')}>Clear search</Button> : undefined}>
          {text ? `Matching “${text}”` : 'All users'} {loaded && <Counter>{total}</Counter>}
        </BoxHeader>
        {loading && !loaded && [0, 1, 2].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && items.length === 0 && <BoxEmpty icon={UsersIcon} title="No users" description={text ? 'No account has that email or name. They are matched whole.' : undefined} />}
        {items.map(user => (
          <BoxRow key={user.id} leading={<Avatar name={user.name} size={8} />} trailing={user.staff ? <Badge tone="brand">staff</Badge> : undefined}>
            <BoxRowTitle href={`/users/${user.id}`}>{user.name}</BoxRowTitle>
            <BoxRowMeta>
              <>{user.email}</>
              <>signed up <RelativeTime date={user.createdAt} /></>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && (
          <BoxFooter>
            <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void users.list.loadMore()}>Load more</Button>
          </BoxFooter>
        )}
      </Box>
    </Stack>
  )
}
