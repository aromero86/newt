import { cooperApp } from '../vite-app'

// The staff's console. Its context serves only the API.
export default cooperApp({ name: 'backoffice', port: 5173, backend: 'http://localhost:3003', proxy: ['/api'] })
