import type { Novelive } from '@novelive/creator/contract'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
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
import { WorkPage } from './pages/work/WorkPage'
import { WorkProduction } from './pages/work/WorkProduction'
import { productionRoutes } from './routes/production'
import { AppShell } from './shell/AppShell'
import '@fontsource/hanken-grotesk/400.css'
import '@fontsource/manrope/700.css'
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import '@fontsource/noto-sans-tc/chinese-traditional-400.css'
import '@fontsource/noto-sans-jp/japanese-400.css'
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
					<Route path={productionRoutes.play} element={<PlayerPage />} />
					<Route path="/package/:id/:version" element={<PlayerPage />} />
					<Route element={<AppShell />}>
						<Route index element={<LibraryPage />} />
						<Route path="import" element={<ImportPage />} />
						<Route path="usage" element={<UsagePage />} />
						<Route path="settings" element={<SettingsPage />} />
						<Route path={productionRoutes.editor} element={<EditorPage />} />
						<Route path={productionRoutes.bible} element={<BiblePage />} />
						<Route element={<WorkProduction />}>
							<Route path={productionRoutes.work} element={<WorkPage />} />
							<Route
								path={productionRoutes.production}
								element={<ProductionPage />}
							/>
							<Route
								path={productionRoutes.confirmVisual}
								element={<ConfirmVisualPage />}
							/>
							<Route
								path={productionRoutes.confirmFirst}
								element={<ConfirmFirstPage />}
							/>
						</Route>
						<Route path="*" element={<Navigate to="/" replace />} />
					</Route>
				</Routes>
			</HashRouter>
		</StrictMode>,
	)
