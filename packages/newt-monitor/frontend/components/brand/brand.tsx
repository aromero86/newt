import { ActivityIcon } from 'lucide-react'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { Text } from '@newt-kit/react-ui/text'

/** The monitor's mark and name. */
export function Brand({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <Inline gap={2}>
      <Icon icon={ActivityIcon} size="lg" />
      <Text weight="semibold" size={size}>newt-monitor</Text>
    </Inline>
  )
}
