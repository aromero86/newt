import { cooperApp } from '../vite-app'

// Signing in, signing up and granting access. Its context is the OAuth server: the
// API, the authorization endpoints and their metadata.
export default cooperApp({ name: 'auth', port: 5171, proxy: ['/api', '/oauth', '/.well-known'] })
