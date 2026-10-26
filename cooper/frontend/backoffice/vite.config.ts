import { cooperApp } from '../vite-app.ts'

// The staff's console. Its context serves only the API.
export default cooperApp({ name: 'backoffice', port: 5173, proxy: ['/api'] })
