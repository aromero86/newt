import { newt } from 'newt-eslint'

// The examples are applications built with newt: they keep its lint. The framework's
// own code is not an application, so it is left out.
export default [
  { ignores: ['packages/**', 'docs/**'] },
  ...newt(),
]
