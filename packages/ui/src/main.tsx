import type { Novelive } from '@novelive/creator/contract'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ImportPage } from './pages/import/ImportPage'
import { LibraryPage } from './pages/library/LibraryPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { UsagePage } from './pages/usage/UsagePage'
import { AppShell } from './shell/AppShell'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/manrope/700.css'
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import './styles/tokens.css'
import './styles/shell.css'

declare global {
	interface Window {
		novelive: Novelive
	}
}

const root = document.getElementById('root')
if (root)
	createRoot(root).render(
		<StrictMode>
			<HashRouter>
				<Routes>
					<Route element={<AppShell />}>
						<Route index element={<LibraryPage />} />
						<Route path="import" element={<ImportPage />} />
						<Route path="usage" element={<UsagePage />} />
						<Route path="settings" element={<SettingsPage />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</Route>
				</Routes>
			</HashRouter>
		</StrictMode>,
	)
