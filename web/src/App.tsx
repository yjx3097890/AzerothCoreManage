import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { RequireAuth } from './layout/RequireAuth'
import { AnnouncementsPage } from './pages/AnnouncementsPage'
import { AccountsPage } from './pages/AccountsPage'
import { AuditPage } from './pages/AuditPage'
import { CharactersPage } from './pages/CharactersPage'
import { ConfigPage } from './pages/ConfigPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { MailPage } from './pages/MailPage'
import { ModerationPage } from './pages/ModerationPage'
import { ModulesPage } from './pages/ModulesPage'
import { PlayerbotsPage } from './pages/PlayerbotsPage'
import { ServersPage } from './pages/ServersPage'
import { SettingsPage } from './pages/SettingsPage'
import { SqlBrowserPage } from './pages/SqlBrowserPage'
import { TicketsPage } from './pages/TicketsPage'
import { AuctionsPage } from './pages/AuctionsPage'
import { EventsPage } from './pages/EventsPage'
import { GuildsPage } from './pages/GuildsPage'
import { hasMinRole } from './api/client'

function SuperAdminOnly({ children }: { children: ReactNode }) {
  if (!hasMinRole('superadmin')) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/characters" element={<CharactersPage />} />
          <Route path="/moderation" element={<ModerationPage />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/guilds" element={<GuildsPage />} />
          <Route path="/auctions" element={<AuctionsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/playerbots" element={<PlayerbotsPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/logs" element={<Navigate to="/servers?tab=logs" replace />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route
            path="/sql"
            element={
              <SuperAdminOnly>
                <SqlBrowserPage />
              </SuperAdminOnly>
            }
          />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
