import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import { AuthGate } from './auth/AuthGate'
import { AppProvider } from './app/AppContext'
import { Layout } from './app/Layout'
import { ToastProvider } from './components/Toast'
import { Dashboard } from './pages/Dashboard'
import { Transactions } from './pages/Transactions'
import { Settings } from './pages/Settings'
import { configured } from './lib/supabase'
import { applyTheme, storedTheme } from './lib/theme'

applyTheme(storedTheme())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 },
  },
})

function NotConfigured() {
  return (
    <main className="min-h-dvh grid place-items-center p-6">
      <div className="max-w-md">
        <h1 className="text-2xl font-bold mb-3">Mangler oppsett</h1>
        <p className="text-muted">
          Appen vet ikke hvilken database den skal bruke. Sett VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY,
          lokalt i filen .env.local eller som variabler i GitHub-repoet. Se README.
        </p>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {configured ? (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthGate>
            {(session) => (
              <AppProvider session={session}>
                <HashRouter>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<Dashboard />} />
                      <Route path="transaksjoner" element={<Transactions />} />
                      <Route path="innstillinger" element={<Settings />} />
                      <Route path="*" element={<Dashboard />} />
                    </Route>
                  </Routes>
                </HashRouter>
              </AppProvider>
            )}
          </AuthGate>
        </ToastProvider>
      </QueryClientProvider>
    ) : <NotConfigured />}
  </StrictMode>,
)
