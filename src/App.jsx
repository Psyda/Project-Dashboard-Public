import { useState, useEffect } from 'react'
import Dashboard from './Dashboard'
import ClientPortal from './ClientPortal'

/*
 * Simple hash-based router. No extra dependencies.
 *
 * URLs:
 *   yourdomain.com/           → Client Portal (what clients see)
 *   yourdomain.com/#/admin    → Your Dashboard (your private view)
 *
 * Why hash routing? Cloudflare Pages serves static files.
 * With hash routing, every URL loads the same index.html and
 * JavaScript handles which page to show. No server config needed.
 */

export default function App() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (route === '#/admin') {
    return <Dashboard />
  }

  return <ClientPortal />
}
