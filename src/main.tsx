import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ToastHost } from './components/ui/Toast'
import { isConfigured } from './lib/supabase'
import { ConfigError } from './pages/public/Misc'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <App />
            <ToastHost />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    ) : <ConfigError />}
  </StrictMode>,
)
