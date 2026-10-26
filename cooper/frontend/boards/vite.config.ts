import { cooperApp } from '../vite-app.ts'

// The SaaS. Its context serves the API.
export default cooperApp({ name: 'boards', port: 5172, proxy: ['/api'] })
