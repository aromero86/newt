import tseslint from 'typescript-eslint'
import { newt } from 'newt-eslint'
import { newtReactUi } from 'newt-react-ui/lint'

// cooper is an application built with newt: its backend keeps newt's lint, and its
// frontends newt-react-ui's. The framework's own code is not
// an application, so it is left out; newt-monitor is one, so it is in.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})

// newt-monitor is an application built with newt too, so it keeps the same lint.
const MONITOR = newt({
  files: ['packages/newt-monitor/{scripts,backend}/**/*.ts'],
  contexts: { folder: 'packages/newt-monitor/backend/contexts', uses: { auth: [], monitor: ['auth'] } },
})

// Its frontend composes newt-react-ui's components, as cooper's do. Of the backend it
// imports only its modules' contracts (their *.schema.ts), and only its API clients do.
const MONITOR_FRONTEND = newtReactUi({
  files: ['packages/newt-monitor/frontend/**/*.{ts,tsx}'],
  components: ['packages/newt-monitor/frontend/components/**'],
  imports: [{
    regex: '(^|/)backend(/|$)',
    message: 'The monitor\'s pages never import its backend: use its client in frontend/api.',
  }],
})

// newt-react-ui's gallery is an app like any other: it keeps the library's lint.
const UI_GALLERY = newtReactUi({ files: ['packages/newt-react-ui/gallery/**/*.{ts,tsx}'] })

// The frontend reaches the backend only through @cooper/api, the API clients.
const BACKEND_IMPORTS = {
  regex: '(^|/)backend(/|$)',
  message: 'The frontend never imports the backend: use the client in @cooper/api.',
}

// The API clients share the backend's contract, never its code: a module's schema file
// is the only thing they may import from the backend.
const API_BACKEND_IMPORTS = {
  regex: '(^|/)backend(/(?!contexts/[^/]+/modules/[^/]+/[^/]+\\.schema(\\.[jt]s)?$)|$)',
  message: '@cooper/api may only import a backend module\'s *.schema.ts (its contract).',
}

// The same for the monitor's clients: of its backend, only its modules' schemas.
const MONITOR_API_BACKEND_IMPORTS = {
  regex: '(^|/)backend(/(?!contexts/[^/]+/modules/[^/]+/[^/]+\\.schema(\\.[jt]s)?$)|$)',
  message: 'The monitor\'s API clients may only import a module\'s *.schema.ts (its contract).',
}
const MONITOR_API_TEST_IMPORTS = {
  regex: '(^|/)backend(/(?!contexts/[^/]+/modules/[^/]+/[^/]+\\.schema(\\.[jt]s)?$|testing/)|$)',
  message: 'A test of the monitor\'s API clients may import a module\'s *.schema.ts and backend/testing, nothing else of the backend.',
}

// cooper's frontends compose newt-react-ui's components and style nothing: only cooper's
// own components (cooper/libs/ui, each app's components/) style, wrapping the library's.
const FRONTEND = newtReactUi({
  files: ['cooper/frontend/**/*.{ts,tsx}'],
  components: ['cooper/libs/ui/**', 'cooper/frontend/*/components/**'],
  imports: [BACKEND_IMPORTS],
})

export default [
  { ignores: ['packages/newt/**', 'packages/newt-eslint/**', 'web/**', '**/dist/**', '.claude/**', '.review/**'] },
  ...BACKEND,
  ...MONITOR,
  ...MONITOR_FRONTEND,
  ...UI_GALLERY,
  ...FRONTEND,
  {
    files: ['cooper/libs/api/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [API_BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['packages/newt-monitor/frontend/api/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [MONITOR_API_BACKEND_IMPORTS] }],
    },
  },
  {
    // Their tests run them against the monitor itself, so they open one.
    files: ['packages/newt-monitor/frontend/api/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [MONITOR_API_TEST_IMPORTS] }],
    },
  },
]
