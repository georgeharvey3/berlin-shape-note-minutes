import React from 'react'
import { createRoot } from 'react-dom/client'
// The two faces of the page come from the bundle and not from a font CDN, so
// the service worker caches them and the app keeps its type without a network.
// Newsreader is a variable font, so one file gives every weight.
import '@fontsource-variable/newsreader'
// Latin and latin-ext only. Latin-ext carries the umlauts and the accents of
// the names of the leaders.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans/latin-ext-400.css'
import '@fontsource/ibm-plex-sans/latin-ext-600.css'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// The service worker caches the app so that it starts without a network. The
// development server has no service worker, because a cache hides the edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
  })
}
