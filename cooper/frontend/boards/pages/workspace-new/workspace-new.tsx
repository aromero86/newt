import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { Inline } from '@cooper/ui/components/inline'
import { PageBody } from '@cooper/ui/components/page-body'
import { PageHeader } from '@cooper/ui/components/page-header'
import { Stack } from '@cooper/ui/components/stack'
import { FormField } from '@cooper/core/form/form-field'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { WorkspaceNewService } from './workspace-new.service'

/** With its own WorkspaceNewService: whoever renders it needs nothing else. */
export function WorkspaceNew() {
  return (
    <Provide services={[WorkspaceNewService]}>
      <WorkspaceNewWrapped />
    </Provide>
  )
}

function WorkspaceNewWrapped() {
  const service = useService(WorkspaceNewService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const workspace = await service.submit()
    if (workspace) navigate(`/w/${workspace.id}`)
  }

  return (
    <PageBody width="narrow">
      <Stack gap={6}>
        <PageHeader title="Create a new workspace" description="You will be its admin: only the people you invite will see its boards." />
        <form onSubmit={event => void onSubmit(event)} noValidate>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not create it">{failure}</Alert>}
            <FormField form={service.form} name="name" label="Name" description="Your team or project, for example Acme Design." />
            <Inline gap={2}>
              <Button type="submit" loading={submitting}>Create workspace</Button>
              <Button variant="ghost" href="/">Cancel</Button>
            </Inline>
          </Stack>
        </form>
      </Stack>
    </PageBody>
  )
}
