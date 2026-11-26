import { useEffect, useState } from 'react'

/**
 * 用户自选路径的展示：折叠家目录为 `~`，去掉末尾斜杠，
 * 超长路径中间省略。绝不隐藏用户选择的路径本身。
 */

/** 把 `home` 前缀折叠为 `~`，并去掉末尾斜杠。分隔符跟随输入路径。 */
export function collapseHome(path: string, home?: string): string {
	let collapsed = path
	if (home) {
		const prefix = /[/\\]$/.test(home) ? home.slice(0, -1) : home
		// Windows 下盘符大小写、两个方向的斜杠都等价，比较前归一化
		const normalizedPrefix = prefix.toLowerCase().replaceAll('\\', '/')
		const normalizedHead = collapsed
			.slice(0, prefix.length)
			.toLowerCase()
			.replaceAll('\\', '/')
		if (normalizedHead === normalizedPrefix) {
			if (collapsed.length === prefix.length) collapsed = '~'
			else {
				const rest = collapsed.slice(prefix.length)
				if (rest.startsWith('/') || rest.startsWith('\\'))
					collapsed = `~${rest}`
			}
		}
	}
	while (collapsed.length > 1 && /[/\\]$/.test(collapsed))
		collapsed = collapsed.slice(0, -1)
	return collapsed
}

/** 中间省略：保留头尾，中间用 `…` 连接，尽量在路径分隔处断开。 */
export function middleEllipsis(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text
	if (maxLength < 2) return '…'
	const budget = maxLength - 1
	const headBudget = Math.ceil(budget / 2)
	const tailBudget = Math.floor(budget / 2)
	let head = text.slice(0, headBudget)
	let tail = text.slice(text.length - tailBudget)
	const headSlash = Math.max(head.lastIndexOf('/'), head.lastIndexOf('\\'))
	if (headSlash > 0) head = head.slice(0, headSlash + 1)
	const tailSlash = tail.search(/[\\/]/)
	if (tailSlash >= 0 && tailSlash < tail.length - 1)
		tail = tail.slice(tailSlash + 1)
	return `${head}…${tail}`
}

/**
 * 展示用路径：先折叠家目录，再按 maxLength 中间省略。
 * 传入了 home 才能折叠；折叠后明显变短，通常不再需要省略。
 */
export function formatPath(
	path: string,
	home?: string,
	maxLength = 56,
): string {
	return middleEllipsis(collapseHome(path, home), maxLength)
}

let cachedHome: string | undefined
let pendingHome: Promise<string | undefined> | undefined

async function queryHome(): Promise<{ ok: boolean; home?: string }> {
	try {
		const state = await window.novelive.host.appState()
		return {
			ok: true,
			home:
				typeof state.homeDir === 'string' && state.homeDir
					? state.homeDir
					: undefined,
		}
	} catch {
		return { ok: false }
	}
}

function loadHome(): Promise<string | undefined> {
	pendingHome ??= queryHome().then(({ ok, home }) => {
		if (ok) {
			// 查询成功即缓存（包括没有家目录的 web 场景）；
			// 查询失败时清空待定 promise，之后挂载的组件会重试。
			cachedHome = home
		} else {
			pendingHome = undefined
		}
		return cachedHome
	})
	return pendingHome
}

/** React hook：主机快照中的家目录，用于 `formatPath` 折叠。 */
export function useHomeDir(): string | undefined {
	const [home, setHome] = useState(cachedHome)
	useEffect(() => {
		let active = true
		void loadHome().then((value) => {
			if (active) setHome(value)
		})
		return () => {
			active = false
		}
	}, [])
	return home
}
