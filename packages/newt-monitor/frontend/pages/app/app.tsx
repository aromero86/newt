import { useParams } from 'react-router'
import { PageHeader } from 'newt-react-ui/page-header'

/** One application: what the monitor knows of it. */
export function App() {
  const { appId } = useParams()
  return <PageHeader title="Application" description={appId} />
}
