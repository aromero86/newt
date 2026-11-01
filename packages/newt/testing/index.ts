// newt-kit/testing: what a test of an application's HTTP entry needs: a free port, and a
// browser that keeps its cookies and never follows a redirect on its own.

export { freePort } from './free-port'
export { browser, type Browser, type BrowserRequest } from './browser'
