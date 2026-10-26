import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { SearchIcon, SquareKanbanIcon } from 'lucide-react'
import { Alert } from '@cooper/ui/components/alert'
import { Avatar } from '@cooper/ui/components/avatar'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { Icon } from '@cooper/ui/components/icon'
import { Inline } from '@cooper/ui/components/inline'
import { Input } from '@cooper/ui/components/input'
import { Select } from '@cooper/ui/components/select'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Stack } from '@cooper/ui/components/stack'
import { Subhead } from '@cooper/ui/components/subhead'
import { Mono } from '@cooper/ui/components/text'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { WorkspaceService } from '../workspace/workspace.service'
import { SearchService, type SearchCriteria } from './search.service'

/** What the filters say for "any": Radix's select takes no empty value. */
const ANY = 'any'
const orAny = (value: string) => (value === ANY ? '' : value)

/** Each criterion's name in the address: `?q=login&board=…&column=…&assignee=…`. */
const PARAMS = { text: 'q', boardId: 'board', columnId: 'column', assigneeId: 'assignee' } as const satisfies Record<keyof SearchCriteria, string>
const KEYS = Object.keys(PARAMS) as (keyof SearchCriteria)[]

/** With its own SearchService: whoever renders it needs nothing else. */
export function Search() {
  return (
    <Provide services={[SearchService]}>
      <SearchWrapped />
    </Provide>
  )
}

/** The workspace's cards, across its boards: by words, board, column and assignee. */
function SearchWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(SearchService)
  // The criteria live in the address: a reload, a shared link or going back keeps them.
  const [params, setParams] = useSearchParams()
  const criteria = Object.fromEntries(KEYS.map(key => [key, params.get(PARAMS[key]) ?? ''])) as SearchCriteria
  const boards = useValue(service.boards)
  const columns = useValue(service.columns)
  const items = useValue(service.results.items)
  const total = useValue(service.results.total)
  const loaded = useValue(service.results.loaded)
  const loading = useValue(service.results.loading)
  const hasMore = useValue(service.results.hasMore)
  const loadingMore = useValue(service.results.loadingMore)
  const failure = useValue(service.results.failure)
  const members = useValue(useService(WorkspaceService).members)
  const membersById = useValue(useService(WorkspaceService).byId)
  // What is being typed, until it is searched for.
  const [text, setText] = useState(criteria.text)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  const { text: searched, boardId, columnId, assigneeId } = criteria
  useEffect(() => {
    void service.search({ text: searched, boardId, columnId, assigneeId })
    setText(searched)
  }, [service, workspaceId, searched, boardId, columnId, assigneeId])

  /** Searches again with these criteria changed, through the address. */
  function change(next: Partial<SearchCriteria>) {
    const merged = { ...criteria, ...next }
    setParams(new URLSearchParams(KEYS.flatMap(key => (merged[key].trim() ? [[PARAMS[key], merged[key].trim()]] : []))), { replace: true })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    change({ text })
  }

  const boardNames = new Map(boards.map(board => [board.id, board.name]))
  const columnNames = new Map(columns.map(column => [column.id, column.name]))

  return (
    <Stack gap={4}>
      <Subhead title="Search cards" description="Across every board of the workspace, by the words in their title or description." />
      <form role="search" aria-label="Search cards" onSubmit={onSubmit}>
        <Stack gap={3}>
          <Inline gap={2}>
            <Input type="search" label="Words to search for" placeholder="Words in a title or description" value={text} onChange={setText} />
            <Button type="submit" variant="outline"><Icon icon={SearchIcon} size="sm" />Search</Button>
          </Inline>
          <Inline gap={2} wrap>
            <Select
              size="compact"
              label="Board"
              value={criteria.boardId || ANY}
              options={[{ value: ANY, label: 'Any board' }, ...boards.map(board => ({ value: board.id, label: board.name }))]}
              onValueChange={value => change({ boardId: orAny(value), columnId: '' })}
            />
            <Select
              size="compact"
              label="Column"
              disabled={!criteria.boardId}
              value={criteria.columnId || ANY}
              options={[{ value: ANY, label: criteria.boardId ? 'Any column' : 'Choose a board for its columns' }, ...columns.map(column => ({ value: column.id, label: column.name }))]}
              onValueChange={value => change({ columnId: orAny(value) })}
            />
            <Select
              size="compact"
              label="Assignee"
              value={criteria.assigneeId || ANY}
              options={[{ value: ANY, label: 'Anyone' }, ...members.map(member => ({ value: member.id, label: member.name }))]}
              onValueChange={value => change({ assigneeId: orAny(value) })}
            />
          </Inline>
        </Stack>
      </form>
      {failure && <Alert tone="bad" title="Could not search">{failure}</Alert>}
      <Box label="Cards found">
        <BoxHeader>{loaded ? `${total} ${total === 1 ? 'card' : 'cards'}` : 'Cards'}</BoxHeader>
        {loading && !loaded && [0, 1, 2].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && items.length === 0 && <BoxEmpty icon={SearchIcon} title="No cards found" description="Try other words, or fewer filters." />}
        {items.map(card => {
          const assignee = card.assigneeId ? membersById.get(card.assigneeId) : undefined
          return (
            <BoxRow
              key={card.id}
              leading={<Icon icon={SquareKanbanIcon} tone="muted" />}
              trailing={assignee && <Inline gap={2}><Avatar name={assignee.name} size={5} />{assignee.name}</Inline>}
            >
              <BoxRowTitle href={`/w/${workspaceId}/boards/${card.boardId}?card=${card.id}`}>{card.title}</BoxRowTitle>
              <BoxRowMeta>
                <Mono>#{card.number}</Mono>
                <span>{boardNames.get(card.boardId) ?? 'A board'}</span>
                {columnNames.has(card.columnId) && <span>{columnNames.get(card.columnId)}</span>}
              </BoxRowMeta>
            </BoxRow>
          )
        })}
        {hasMore && <BoxFooter><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.results.loadMore()}>Load more</Button></BoxFooter>}
      </Box>
    </Stack>
  )
}
