// bun run cooper:seed: cooper's demo data, written through the contexts' use cases as
// anyone would (a staff user, a demo workspace). Nothing yet: the modules come first.
import { config } from '../backend/config'
import { openContexts, stopContexts } from '../backend/open-contexts'

const contexts = await openContexts(config)
try {
  // The seed goes here.
} finally {
  await stopContexts(contexts)
}
