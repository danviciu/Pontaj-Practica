import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Register a cleanup worker to remove stale caches from previous deployments.
        navigator.serviceWorker.register('/sw.js').catch(() => {
            // Service worker is optional; app should still work without it.
        });
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
)
