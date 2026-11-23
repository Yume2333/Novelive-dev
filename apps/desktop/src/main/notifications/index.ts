import {
	type ProductionSnapshot,
	productionSnapshotEvent,
} from '@novelive/creator/contract'
import { type BrowserWindow, ipcMain, Notification } from 'electron'

const titles = {
	confirm: '等待确认',
	attention: '需要处理',
	done: '制作完成',
	chapter: '新章已就绪',
} as const

export function cleanText(value: string) {
	return value
		.replace(/<[^>]*>/g, '')
		.replace(/[\r\n\t]+/g, ' ')
		.slice(0, 1000)
}

export function installNotifications(
	window: () => BrowserWindow | undefined,
	show: () => void,
) {
	const previous = new Map<string, ProductionSnapshot>()
	const notifications = new Set<Notification>()
	let waiting: string | undefined
	ipcMain.on('novelive:player-waiting', (event, workId: unknown) => {
		if (event.sender !== window()?.webContents) return
		if (workId === null) waiting = undefined
		else if (
			typeof workId === 'string' &&
			workId.length > 0 &&
			workId.length <= 1000
		)
			waiting = workId
	})
	function notify(
		kind: keyof typeof titles,
		body: string,
		workId: string,
		suffix: string,
	) {
		if (!Notification.isSupported()) return
		const notification = new Notification({
			title: titles[kind],
			body: cleanText(body),
		})
		notifications.add(notification)
		notification.once('close', () => notifications.delete(notification))
		notification.once('failed', () => notifications.delete(notification))
		notification.once('click', () => {
			show()
			window()?.webContents.send(
				'novelive:locate',
				`/work/${encodeURIComponent(workId)}${suffix}`,
			)
			notifications.delete(notification)
		})
		notification.show()
	}
	ipcMain.on('novelive:production-event', (event, input: unknown) => {
		if (
			event.sender !== window()?.webContents ||
			!productionSnapshotEvent.check(input)
		)
			return
		const snapshot = input.payload
		if (snapshot.workId.length > 1000 || (snapshot.title?.length ?? 0) > 1000)
			return
		const before = previous.get(snapshot.workId)
		previous.set(snapshot.workId, snapshot)
		const title = snapshot.title ?? '作品'
		if (
			snapshot.status === 'confirm' &&
			(before?.phase !== snapshot.phase || before.status !== 'confirm')
		) {
			const visual = snapshot.phase === 'confirm-visual'
			notify(
				'confirm',
				`${title} · ${visual ? '角色设定 / 主视觉' : '第一章试玩'}`,
				snapshot.workId,
				`/confirm/${visual ? 'visual' : 'first'}`,
			)
		}
		if (snapshot.phase === 'done' && before?.phase !== 'done')
			notify('done', `${title} · 全部章节`, snapshot.workId, '')
		const issue = snapshot.chapters.find(
			(chapter) =>
				chapter.issue &&
				!before?.chapters.some(
					(old) =>
						old.chapterId === chapter.chapterId && old.issue === chapter.issue,
				),
		)
		if (
			issue ||
			(snapshot.blockedChapterId &&
				snapshot.blockedChapterId !== before?.blockedChapterId)
		)
			notify('attention', `${title} · 制作`, snapshot.workId, '/production')
		if (waiting === snapshot.workId && !window()?.isFocused()) {
			const chapter = snapshot.chapters.find(
				(item) =>
					item.status === 'published' &&
					before?.chapters.some(
						(old) =>
							old.chapterId === item.chapterId && old.status !== 'published',
					),
			)
			if (chapter) {
				notify(
					'chapter',
					`${title} · ${snapshot.chapterTitles?.[chapter.chapterId] ?? '新章'}`,
					snapshot.workId,
					'/play',
				)
				waiting = undefined
			}
		}
	})
	return () => {
		for (const notification of notifications) notification.close()
		notifications.clear()
	}
}
