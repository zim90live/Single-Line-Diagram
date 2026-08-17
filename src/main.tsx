import '@fontsource-variable/google-sans-code'
import { createRoot } from 'react-dom/client'

import App from './App'
import './styles/theme.generated.css'
import './styles/components.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)
