import { createRoot } from 'react-dom/client'
import App from './App'
import OAuthCallback from './components/OAuthCallback'

const path = window.location.pathname
const root = createRoot(document.getElementById('root')!)
if (path === '/oauth/callback') {
	root.render(<OAuthCallback />)
} else {
	root.render(<App />)
}
