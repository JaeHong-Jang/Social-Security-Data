import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import '../../../design/tokens.css'
import '../../../design/directions/D/tokens-d.css'
import '../../../design/directions/E/tokens-e.css'
import './styles.css'
import './d.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <App />
  </HashRouter>,
)
