import { useState } from 'react'
import { BlocksIcon, ClockIcon, MegaphoneIcon, SearchXIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { SearchField } from 'newt-react-ui/search-field'
import { Inline } from 'newt-react-ui/inline'
import { Stack } from 'newt-react-ui/stack'
import { Mono } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppRemovedRow, AppRemovedToggle, useRemoved } from '../app-removed/app-removed'
import { AppService } from '../app.service'
import { contextHref, matches, moduleHref, reactionsOf } from '../app-structure'

/** Every event of the application, by context, with who hears each one, and a filter. */
export function AppEvents({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const [filter, setFilter] = useState('')
  const removed = useRemoved()
  if (!structure) return <AppNotRead app={app} />

  const reactions = reactionsOf(structure.description)
  const gone = removed.filter(item => item.kind === 'event' && matches(item.itemId, filter))
  const current = structure.description.contexts.map(context => context.name)
  const contexts = [...structure.description.contexts, ...[...new Set(gone.map(item => item.context))].filter(name => !current.includes(name)).map(name => ({ name, modules: [] }))]
    .map(context => ({
      ...context,
      gone: gone.filter(item => item.context === context.name),
      events: context.modules.flatMap(module => module.events.map(event => ({ ...event, module }))).filter(event => matches(event.id, filter)),
    }))
    .filter(context => context.events.length > 0 || context.gone.length > 0)

  return (
    <Stack gap={4}>
      <Inline gap={2}>
        <SearchField live label="Filter events" placeholder="Filter events: card created" onSearch={setFilter} />
        <AppRemovedToggle />
      </Inline>
      {contexts.length === 0 && (
        <Box label="Events">
          <BoxEmpty icon={SearchXIcon} title="No event matches" description="Every word is looked for in its context, its module and its name." />
        </Box>
      )}
      {contexts.map(context => (
        <Box key={context.name} label={`Events of ${context.name}`}>
          <BoxHeader><Icon icon={BlocksIcon} tone="muted" /> <TextLink href={contextHref(app.id, context.name)}>{context.name}</TextLink> <Counter>{context.events.length + context.gone.length}</Counter></BoxHeader>
          {context.events.map(event => {
            const listeners = reactions.filter(reaction => reaction.event === event.id)
            return (
              <BoxRow
                key={event.id}
                leading={<Icon icon={event.schedule ? ClockIcon : MegaphoneIcon} tone="muted" />}
                trailing={event.schedule ? <Badge tone="info">{event.schedule.cron}</Badge> : <Counter>{listeners.length}</Counter>}
              >
                <BoxRowTitle href={moduleHref(app.id, event.module.id)}><Mono>{event.name}</Mono></BoxRowTitle>
                <BoxRowMeta>
                  {event.schedule && <>a schedule</>}
                  <>{listeners.length ? `heard by ${listeners.map(listener => listener.handler ?? 'a fire-and-forget handler').join(', ')}` : 'heard by nobody'}</>
                </BoxRowMeta>
              </BoxRow>
            )
          })}
          {context.gone.map(item => <AppRemovedRow key={item.id} item={item} href={moduleHref(app.id, `${item.context}/${item.module}`)} />)}
        </Box>
      ))}
    </Stack>
  )
}
