// SPDX-License-Identifier: MPL-2.0

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './theme/obsidian-solar-amber.css'
import './theme/palette.css'
import './styles.css'
import './theme/desktop-shell.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
