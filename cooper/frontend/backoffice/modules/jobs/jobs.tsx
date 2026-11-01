import { useEffect } from 'react'
import { JOB_CONTEXTS, type JobContext } from '@cooper/api/backoffice-job'
import { PageHeader } from 'newt-kit-react-ui/page-header'
import { Stack } from 'newt-kit-react-ui/stack'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'newt-kit-react-ui/tabs'
import { Provide, useService, useValue } from 'newt-kit-react'
import { JobsList } from './jobs-list'
import { JobsService } from './jobs.service'

/** The jobs that ran out of attempts, context by context. With its own JobsService. */
export function Jobs() {
  return (
    <Provide services={[JobsService]}>
      <JobsWrapped />
    </Provide>
  )
}

function JobsWrapped() {
  const jobs = useService(JobsService)

  useEffect(() => {
    void jobs.load()
  }, [jobs])

  return (
    <Stack gap={6}>
      <PageHeader title="Jobs" description="Reactions that failed every attempt. Fix what killed one, then retry it: its context runs it again." />
      <Tabs defaultValue="auth">
        <TabsList label="Contexts">
          {JOB_CONTEXTS.map(context => <JobsTab key={context} context={context} />)}
        </TabsList>
        {JOB_CONTEXTS.map(context => (
          <TabsContent key={context} value={context}>
            <JobsList context={context} />
          </TabsContent>
        ))}
      </Tabs>
    </Stack>
  )
}

/** A context's tab, with how many dead jobs it has once they are counted. */
function JobsTab({ context }: { context: JobContext }) {
  const list = useService(JobsService).lists[context]
  const total = useValue(list.total)
  const loaded = useValue(list.loaded)
  return <TabsTrigger value={context} count={loaded ? total : undefined}>{context}</TabsTrigger>
}
