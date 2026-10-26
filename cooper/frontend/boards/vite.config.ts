import { cooperApp } from '../vite-app'

// The SaaS. Its context serves the API, the MCP server and the OAuth metadata that points to auth.
export default cooperApp({ name: 'boards', port: 5172, backend: 'http://localhost:3002', proxy: ['/api', '/mcp', '/.well-known'] })
