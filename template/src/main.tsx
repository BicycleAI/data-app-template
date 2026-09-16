/**
 * Boot.
 *
 * The context has to be resolved before anything renders — the client reads the
 * app id and token from it — so this awaits it and renders a plain message if
 * it is missing rather than throwing into a blank frame.
 */

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { initContext } from './studio/context.js'
import { createQueryClient } from './studio/hooks.js'
import './theme.css'

const container = document.getElementById('root')
if (container === null) throw new Error('the host page has no #root element')

const root = createRoot(container)

try {
  await initContext()
  root.render(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
} catch (error) {
  // A boot failure is shown in place. The message comes from our own code, not
  // from a server response, so it is safe to display.
  root.render(<div className="bda-state bda-state--error">{(error as Error).message}</div>)
}

/**
 * The server's validation harness calls this when present, to check the app
 * starts. Exported so a bundle that is imported rather than executed still has
 * a way to be driven once.
 */
export function mount(target: HTMLElement): () => void {
  const mounted = createRoot(target)
  mounted.render(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
  return () => mounted.unmount()
}
