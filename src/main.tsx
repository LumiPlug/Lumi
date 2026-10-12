// SPDX-License-Identifier: MPL-2.0

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ToolRunWindow from './components/ToolRunWindow'
import { runWindowRoute } from './lib/tool-run-window'
import ToastProvider from './components/ToastProvider'
import './theme/obsidian-solar-amber.css'
import './theme/palette.css'
import './styles.css'

const runRoute = runWindowRoute(window.location.search)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>{runRoute ? <ToolRunWindow route={runRoute} /> : <App />}</ToastProvider>
  </StrictMode>,
)
