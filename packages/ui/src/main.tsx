import type { Novelive } from '@novelive/creator/contract'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import './styles/tokens.css'
import './styles/shell.css'

declare global {
	interface Window {
		novelive: Novelive
	}
}

function Library() {
	const [ready, setReady] = useState(false)

	useEffect(() => {
		let active = true
		let sawEvent = false
		const onReady = window.novelive.on('creator.ready', () => {
			sawEvent = true
			setReady(true)
		})
		const onDown = window.novelive.on('creator.down', () => {
			sawEvent = true
			setReady(false)
		})
		void window.novelive.host.appState().then((state) => {
			if (active && !sawEvent) setReady(state.creator === 'ready')
		})
		return () => {
			active = false
			onReady()
			onDown()
		}
	}, [])

	return (
		<main>
			<h1>书库</h1>
			<p>还没有作品</p>
			<p role="status">{ready ? '创作端已就绪' : '创作端未就绪'}</p>
		</main>
	)
}

const root = document.getElementById('root')
if (root)
	createRoot(root).render(
		<StrictMode>
			<Library />
		</StrictMode>,
	)
