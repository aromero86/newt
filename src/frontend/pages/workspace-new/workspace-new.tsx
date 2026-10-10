import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../components/form-field'
import { Provide } from '../../core/injector/provide'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
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
    <Stack gap={8}>
      <PageHeader title="New workspace" description="One per product. You will be its admin, and only the people you add will see it." />
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" loading={submitting}>Create workspace</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not create it">{failure}</Alert>}
            <FormField form={service.form} name="name" label="Name" description="The product it defines, e.g. Acme Shop." />
            <FormField form={service.form} name="description" label="Description" description="Optional: what the product is, in one or two lines." rows={3} />
          </Stack>
        </Card>
      </form>
    </Stack>
  )
}
