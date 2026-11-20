import { HashRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import { ProductionProvider } from './mock/production'
import { BiblePage } from './pages/bible/BiblePage'
import { ConfirmFirstPage } from './pages/confirm/ConfirmFirstPage'
import { ConfirmVisualPage } from './pages/confirm/ConfirmVisualPage'
import { EditorPage } from './pages/editor/EditorPage'
import { ImportPage } from './pages/import/ImportPage'
import { LibraryPage } from './pages/library/LibraryPage'
import { PlayerPage } from './pages/player/PlayerPage'
import { ProductionPage } from './pages/production/ProductionPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { UsagePage } from './pages/usage/UsagePage'
import { WelcomePage } from './pages/welcome/WelcomePage'
import { WorkPage } from './pages/work/WorkPage'
import { AppShell } from './shell/AppShell'
import { ThemeProvider } from './shell/theme'

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ProductionProvider>
          <HashRouter>
            <Routes>
              <Route path="/welcome" element={<WelcomePage />} />
              <Route path="/work/:id/play" element={<PlayerPage />} />
              <Route element={<AppShell />}>
                <Route path="/" element={<LibraryPage />} />
                <Route path="/import" element={<ImportPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/work/:id" element={<WorkPage />} />
                <Route path="/work/:id/production" element={<ProductionPage />} />
                <Route path="/work/:id/edit" element={<EditorPage />} />
                <Route path="/work/:id/bible" element={<BiblePage />} />
                <Route path="/work/:id/confirm/visual" element={<ConfirmVisualPage />} />
                <Route path="/work/:id/confirm/first" element={<ConfirmFirstPage />} />
              </Route>
            </Routes>
          </HashRouter>
        </ProductionProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
