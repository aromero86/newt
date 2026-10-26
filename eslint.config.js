import { newt } from 'newt-eslint'

// cooper is an application built with newt: its backend keeps newt's lint. The
// framework's own code is not an application, so it is left out.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { boards: [] } },
})

export default [
  { ignores: ['packages/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
]
