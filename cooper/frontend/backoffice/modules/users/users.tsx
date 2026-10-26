import { useEffect } from 'react'
import { UsersIcon } from 'lucide-react'
import { Alert } from '@cooper/ui/components/alert'
import { Avatar } from '@cooper/ui/components/avatar'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { Counter } from '@cooper/ui/components/counter'
import { PageHeader } from '@cooper/ui/components/page-header'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { SearchField } from '@cooper/ui/components/search-field'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Stack } from '@cooper/ui/components/stack'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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
      <PageHeader title="Users" description="Every account of Cooper, the newest first." />
      <SearchField label="Search users" placeholder="An email or a whole name" defaultValue={text} onSearch={query => void users.search(query)} />
      {failure && <Alert tone="bad" title="Could not load the users">{failure}</Alert>}
      <Box label="Users">
        <BoxHeader actions={text ? <Button size="sm" variant="ghost" onClick={() => void users.search('')}>Clear search</Button> : undefined}>
          {text ? `Matching “${text}”` : 'All users'} {loaded && <Counter>{total}</Counter>}
        </BoxHeader>
        {loading && !loaded && [0, 1, 2].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && items.length === 0 && <BoxEmpty icon={UsersIcon} title="No users" description={text ? 'No account has that email or name. They are matched whole.' : undefined} />}
        {items.map(user => (
          <BoxRow key={user.id} leading={<Avatar name={user.name} size={8} />}>
            <BoxRowTitle href={`/users/${user.id}`}>{user.name}</BoxRowTitle>
            <BoxRowMeta>
              <span>{user.email}</span>
              <span>·</span>
              <span>signed up <RelativeTime date={user.createdAt} /></span>
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
