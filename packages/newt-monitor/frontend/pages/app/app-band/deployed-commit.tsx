import { GitCommitHorizontalIcon } from 'lucide-react'
import { Icon } from 'newt-kit-react-ui/icon'
import { Inline } from 'newt-kit-react-ui/inline'
import { TextLink } from 'newt-kit-react-ui/link'
import { Mono, Text } from 'newt-kit-react-ui/text'
import { useService, useValue } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { AppService, commitUrl, shortCommit } from '../app.service'

/**
 * The commit deployed now: that of its newest instance alive, with its title once its
 * repository told it, linked to it on GitHub. Nothing while no instance alive says one.
 */
export function DeployedCommit({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const instances = useValue(service.instances)
  const deployments = useValue(service.deployments)
  const newest = instances?.instances
    .filter(instance => instance.status === 'alive' && instance.commit !== null)
    .toSorted((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  if (!newest) return null

  const commit = newest.commit!
  const title = deployments.find(deployment => deployment.commit === commit)?.title
  const url = commitUrl(app.repository, commit)
  const label = <><Mono>{shortCommit(commit)}</Mono>{title ? ` ${title}` : ''}</>
  return (
    <Inline gap={1}>
      <Icon icon={GitCommitHorizontalIcon} size="sm" tone="muted" />
      <Text as="span" size="sm" tone="muted">{url ? <TextLink href={url} external>{label}</TextLink> : label}</Text>
    </Inline>
  )
}
