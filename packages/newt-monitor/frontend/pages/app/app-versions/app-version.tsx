import { useEffect } from 'react'
import { useParams } from 'react-router'
import { BlocksIcon, BoxIcon, MegaphoneIcon, MinusIcon, PlayIcon, PlusIcon } from 'lucide-react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-kit-react-ui/box'
import { Counter } from 'newt-kit-react-ui/counter'
import { Icon } from 'newt-kit-react-ui/icon'
import { TextLink } from 'newt-kit-react-ui/link'
import { RelativeTime } from 'newt-kit-react-ui/relative-time'
import { Spinner } from 'newt-kit-react-ui/spinner'
import { Stack } from 'newt-kit-react-ui/stack'
import { Subhead } from 'newt-kit-react-ui/subhead'
import { Mono } from 'newt-kit-react-ui/text'
import { useService, useValue } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { NotFound } from '../../not-found/not-found'
import { contextHref, differenceOf, moduleHref, partsOf, type Part } from '../app-structure'
import { AppVersionsService } from './app-versions.service'

const KINDS = {
  context: { icon: BlocksIcon, label: 'context' },
  module: { icon: BoxIcon, label: 'module' },
  useCase: { icon: PlayIcon, label: 'use case' },
  event: { icon: MegaphoneIcon, label: 'event' },
} as const

/** One version: what it added to the one before it, and what it took away. */
export function AppVersion({ app }: { app: AppDTO }) {
  const versionId = useParams().versionId!
  const service = useService(AppVersionsService)
  const version = useValue(service.version)
  const previous = useValue(service.previous)
  const failure = useValue(service.failure)

  useEffect(() => {
    void service.open(versionId)
  }, [service, versionId])

  if (failure) return <Alert tone="bad" title="Could not load the version">{failure}</Alert>
  if (version === undefined) return <Spinner label="Loading the version" />
  if (version === null) return <NotFound />

  const versions = <TextLink href={`/apps/${app.id}/settings/versions`}>its versions</TextLink>
  const title = <>Structure read <RelativeTime date={version.takenAt} /></>
  if (!previous) {
    const parts = partsOf(version.description)
    const count = (kind: Part['kind']) => parts.filter(part => part.kind === kind).length
    return (
      <Stack gap={4}>
        <Subhead title={title} description={<>The first of {versions}: <Mono>{version.hash.slice(0, 7)}</Mono>.</>} />
        <Alert tone="info" title="The first version read">
          Everything in it was new: {count('context')} contexts, {count('module')} modules, {count('useCase')} use cases and {count('event')} events.
        </Alert>
      </Stack>
    )
  }

  const { added, removed } = differenceOf(previous.description, version.description)
  return (
    <Stack gap={4}>
      <Subhead title={title} description={<>One of {versions}: <Mono>{version.hash.slice(0, 7)}</Mono>, against the one read <RelativeTime date={previous.takenAt} />.</>} />
      <AppVersionParts appId={app.id} title="Added" icon={PlusIcon} tone="ok" parts={added} />
      <AppVersionParts appId={app.id} title="Removed" icon={MinusIcon} tone="bad" parts={removed} />
    </Stack>
  )
}

function AppVersionParts({ appId, title, icon, tone, parts }: { appId: string, title: string, icon: typeof PlusIcon, tone: 'ok' | 'bad', parts: Part[] }) {
  const href = (part: Part) => part.module === null ? contextHref(appId, part.context) : moduleHref(appId, `${part.context}/${part.module}`)
  return (
    <Box label={title}>
      <BoxHeader><Icon icon={icon} tone={tone} /> {title} <Counter>{parts.length}</Counter></BoxHeader>
      {parts.length === 0 && <BoxEmpty title="Nothing" />}
      {parts.map(part => (
        <BoxRow key={`${part.kind}:${part.id}`} leading={<Icon icon={KINDS[part.kind].icon} tone="muted" />}>
          <BoxRowTitle href={href(part)}><Mono>{part.name}</Mono></BoxRowTitle>
          <BoxRowMeta>
            <>{KINDS[part.kind].label}</>
            {part.kind !== 'context' && <>in {part.context}</>}
          </BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}
