import { useEffect } from 'react'
import { ArchiveIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Mono } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import type { CatalogItemDTO } from '../../../api/catalog'
import { AppService } from '../app.service'

/** Shows or hides, everywhere in the explorer, what some version had and the last one has not. */
export function AppRemovedToggle() {
  const service = useService(AppService)
  const removed = useValue(service.removed)
  const show = useValue(service.showRemoved)

  useEffect(() => {
    void service.loadRemoved()
  }, [service])

  return (
    <Button size="sm" variant={show ? 'secondary' : 'outline'} onClick={() => service.toggleRemoved()}>
      <Icon icon={ArchiveIcon} size="sm" />{show ? 'Hide removed' : 'Show removed'}{removed && <Counter>{removed.length}</Counter>}
    </Button>
  )
}

/** The removed parts the explorer shows: none while they are hidden. */
export function useRemoved(): CatalogItemDTO[] {
  const service = useService(AppService)
  const removed = useValue(service.removed)
  const show = useValue(service.showRemoved)
  return show ? removed ?? [] : []
}

/** A part the last version has not: when it came, and when it went. Nothing of it is lost. */
export function AppRemovedRow({ item, href }: { item: CatalogItemDTO, href?: string }) {
  return (
    <BoxRow leading={<Icon icon={ArchiveIcon} tone="muted" />} trailing={<Badge tone="warn">Removed</Badge>}>
      <BoxRowTitle href={href}>{item.kind === 'useCase' || item.kind === 'event' ? <Mono>{item.name}</Mono> : item.name}</BoxRowTitle>
      <BoxRowMeta>
        <>gone <RelativeTime date={item.archivedAt!} /></>
        <>there since <RelativeTime date={item.firstSeenAt} /></>
      </BoxRowMeta>
    </BoxRow>
  )
}
