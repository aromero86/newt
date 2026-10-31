import { useEffect, type FormEvent } from 'react'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { FormField } from 'newt-react/form-field'
import { Provide, useService, useValue } from 'newt-react'
import { AppSettingsMetricsService } from './app-settings-metrics.service'

/** How long its metrics are kept. With its own AppSettingsMetricsService. */
export function AppSettingsMetrics() {
  return (
    <Provide services={[AppSettingsMetricsService]}>
      <AppSettingsMetricsWrapped />
    </Provide>
  )
}

function AppSettingsMetricsWrapped() {
  const service = useService(AppSettingsMetricsService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const loaded = useValue(service.loaded)

  useEffect(() => {
    void service.load()
  }, [service])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (loaded) void service.save()
  }

  return (
    <Stack gap={0}>
      <Subhead title="Metrics" description="How long its metrics and traces are kept. Each night, what is older goes." />
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4} align="start">
          {failure && <Alert tone="bad" title="Could not save">{failure}</Alert>}
          <FormField form={service.form} name="minuteDays" label="Minute by minute, with who told each" description="Days: what can be filtered by actor, and drawn by the minute. 30 by default." />
          <FormField form={service.form} name="dayDays" label="Day by day, without who" description="Days: what stays once the minutes are gone. Empty to keep it for ever." />
          <FormField form={service.form} name="resourceMinuteDays" label="Servers and instances, minute by minute" description="Days: each server's memory, processors and disks, and how many instances were alive, by the minute. Day by day it is kept as long as the rest. 30 by default." />
          <FormField form={service.form} name="traceDays" label="Traces" description="Days each trace is kept: every one that failed or ran again, and a share of the rest. 7 by default." />
          <Button type="submit" loading={submitting} disabled={!loaded}>Save retention</Button>
        </Stack>
      </form>
    </Stack>
  )
}
