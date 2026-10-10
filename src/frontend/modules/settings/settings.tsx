import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { SettingsPassword } from './settings-password/settings-password'
import { SettingsProfile } from './settings-profile/settings-profile'

export function Settings() {
  return (
    <Stack gap={8}>
      <PageHeader title="Account settings" description="Your account in newt." />
      <SettingsProfile />
      <SettingsPassword />
    </Stack>
  )
}
