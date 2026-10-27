import { useEffect, useState } from 'react'
import { BlocksIcon, PlayIcon, SearchXIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { SearchField } from 'newt-react-ui/search-field'
import { Inline } from 'newt-react-ui/inline'
import { Select } from 'newt-react-ui/select'
import { Stack } from 'newt-react-ui/stack'
import { Mono } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import { UseCaseErrorsApi, type ErrorsTotalDTO } from '../../../api/use-case-errors'
import { UseCaseMetricsApi, type UseCaseTotalDTO } from '../../../api/use-case-metrics'
import { formatMs } from '../app-metrics/metrics-format'
import type { AppDTO } from '../../../api/app'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppRemovedRow, AppRemovedToggle, useRemoved } from '../app-removed/app-removed'
import { AppService } from '../app.service'
import { contextHref, matches, moduleHref } from '../app-structure'

/** Every use case of the application, by context and module, with a filter. */
export function AppUseCases({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const [filter, setFilter] = useState('')
  const removed = useRemoved()
  const totals = useTotals(app)
  const ended = useEnded(app)
  const [sort, setSort] = useState<'structure' | 'calls' | 'retries' | 'failures'>('structure')
  const sortValue = (context: string, useCase: string) => {
    if (sort === 'failures') return ended?.get(`${context}|${useCase}`)?.now.failures ?? 0
    if (sort === 'structure') return 0
    return totals?.get(`${context}|${useCase}`)?.now[sort] ?? 0
  }
  if (!structure) return <AppNotRead app={app} />

  const gone = removed.filter(item => item.kind === 'useCase' && matches(item.itemId, filter))
  const current = structure.description.contexts.map(context => context.name)
  const contexts = [...structure.description.contexts, ...[...new Set(gone.map(item => item.context))].filter(name => !current.includes(name)).map(name => ({ name, modules: [] }))]
    .map(context => ({
      ...context,
      gone: gone.filter(item => item.context === context.name),
      useCases: context.modules.flatMap(module => module.useCases.map(useCase => ({ ...useCase, module }))).filter(useCase => matches(useCase.id, filter))
        .sort((a, b) => sortValue(context.name, b.name) - sortValue(context.name, a.name)),
    }))
    .filter(context => context.useCases.length > 0 || context.gone.length > 0)

  return (
    <Stack gap={4}>
      <Inline gap={2}>
        <SearchField live label="Filter use cases" placeholder="Filter use cases: card create" onSearch={setFilter} />
        <Select
          size="compact"
          label="Sort use cases"
          value={sort}
          onValueChange={value => setSort(value as typeof sort)}
          options={[{ value: 'structure', label: 'As in their modules' }, { value: 'calls', label: 'Most called in 24h' }, { value: 'retries', label: 'Most run again in 24h' }, { value: 'failures', label: 'Most failures in 24h' }]}
        />
        <AppRemovedToggle />
      </Inline>
      {contexts.length === 0 && (
        <Box label="Use cases">
          <BoxEmpty icon={SearchXIcon} title="No use case matches" description="Every word is looked for in its context, its module and its name." />
        </Box>
      )}
      {contexts.map(context => (
        <Box key={context.name} label={`Use cases of ${context.name}`}>
          <BoxHeader><Icon icon={BlocksIcon} tone="muted" /> <TextLink href={contextHref(app.id, context.name)}>{context.name}</TextLink> <Counter>{context.useCases.length + context.gone.length}</Counter></BoxHeader>
          {context.useCases.map(useCase => (
            <BoxRow key={useCase.id} leading={<Icon icon={PlayIcon} tone="muted" />}>
              <BoxRowTitle href={`/apps/${app.id}/use-cases/${context.name}/${useCase.name}`}><Mono>{useCase.name}</Mono></BoxRowTitle>
              <BoxRowMeta>
                {totals && <>{describeTotal(totals.get(`${context.name}|${useCase.name}`))}</>}
                {ended && describeEnded(ended.get(`${context.name}|${useCase.name}`)) && <>{describeEnded(ended.get(`${context.name}|${useCase.name}`))}</>}
                <>{useCase.writesTo.length ? `writes also to ${useCase.writesTo.join(', ')}` : 'writes only to its own module'}</>
                {!useCase.retryOnConflict && <>never retried on a conflict</>}
              </BoxRowMeta>
            </BoxRow>
          ))}
          {context.gone.map(item => <AppRemovedRow key={item.id} item={item} href={moduleHref(app.id, `${item.context}/${item.module}`)} />)}
        </Box>
      ))}
    </Stack>
  )
}

/** Each use case's calls in the last 24 hours: null until known. */
function useTotals(app: AppDTO): Map<string, UseCaseTotalDTO> | null {
  const api = useService(UseCaseMetricsApi)
  const [totals, setTotals] = useState<Map<string, UseCaseTotalDTO> | null>(null)
  useEffect(() => {
    api.totals(app.id, '24h')
      .then(found => setTotals(new Map(found.map(total => [`${total.context}|${total.useCase}`, total]))))
      .catch(() => setTotals(new Map()))
  }, [api, app.id])
  return totals
}

/** `340 calls in 24h, 12 retries, p90 45 ms`. */
function describeTotal(total: UseCaseTotalDTO | undefined): string {
  if (!total || total.now.calls === 0) return 'not called in 24h'
  const retries = total.now.retries ? `, ${total.now.retries.toLocaleString('en')} ${total.now.retries === 1 ? 'retry' : 'retries'}` : ''
  return `${total.now.calls.toLocaleString('en')} calls in 24h${retries}, p90 ${formatMs(total.now.p90)}`
}

/** Each use case's errors and failures in the last 24 hours: null until known. */
function useEnded(app: AppDTO): Map<string, ErrorsTotalDTO> | null {
  const api = useService(UseCaseErrorsApi)
  const [ended, setEnded] = useState<Map<string, ErrorsTotalDTO> | null>(null)
  useEffect(() => {
    api.totals(app.id, '24h')
      .then(found => setEnded(new Map(found.map(total => [`${total.context}|${total.useCase}`, total]))))
      .catch(() => setEnded(new Map()))
  }, [api, app.id])
  return ended
}

/** `3 failures, 12 errors`: none said when it ended badly never. */
function describeEnded(ended: ErrorsTotalDTO | undefined): string | null {
  if (!ended) return null
  const parts = [
    ended.now.failures ? `${ended.now.failures.toLocaleString('en')} ${ended.now.failures === 1 ? 'failure' : 'failures'}` : '',
    ended.now.errors ? `${ended.now.errors.toLocaleString('en')} ${ended.now.errors === 1 ? 'error' : 'errors'}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}
