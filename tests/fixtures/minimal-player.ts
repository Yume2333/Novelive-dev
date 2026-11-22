import { Project } from '../../packages/creator/src/project'
import {
	defaultWorkSettings,
	projectFiles,
} from '../../packages/format/src/model'

export const playerWorkId = '12345678-1234-1234-1234-123456789abc'
export const playerRef = {
	volumeId: 'v1',
	workId: playerWorkId,
	chapterId: 'ch1',
}
export const playerScript = `scene 空屋
source p0001
@bg room/dusk
@show traveler/coat/calm center
traveler as 旅人: 你好，世界。
listener (inner) as 听者: 我在想什么？
: 风从窗边吹过。
@caption 黄昏时分 wait
@hide traveler
: 屋子静了。
`

export async function seedPlayerProject(
	root: string,
	background: Uint8Array,
	sprite: Uint8Array,
) {
	using project = await Project.create(root, {
		formatVersion: 1,
		seriesId: 'minimal',
		title: '合成播放器工程',
		volumeIds: ['v1'],
	})
	await project.write(projectFiles.volume('v1'), {
		formatVersion: 1,
		volumeId: 'v1',
		title: '卷一',
		workIds: [playerWorkId],
	})
	await project.write(projectFiles.work('v1', playerWorkId), {
		formatVersion: 1,
		workId: playerWorkId,
		title: '黄昏',
		chapterIds: ['ch1'],
		version: 1,
		minReaderVersion: 1,
		appVersion: '0.1.0',
		language: 'zh-CN',
		settings: defaultWorkSettings(),
	})
	await project.write(projectFiles.chapter(playerRef), {
		formatVersion: 1,
		chapterId: 'ch1',
		title: '空屋',
		paragraphIds: ['p0001'],
		sceneIds: ['aaaabbbb'],
		cg: [],
	})
	await project.writeFile(
		projectFiles.scene(playerRef, 'aaaabbbb'),
		playerScript,
	)
	for (const [scope, id, name] of [
		[{ level: 'series' }, 'traveler', '旅人'],
		[{ level: 'volume', volumeId: 'v1' }, 'listener', '听者'],
		[
			{ level: 'work', volumeId: 'v1', workId: playerWorkId },
			'witness',
			'见证者',
		],
	] as const) {
		await project.write(projectFiles.character(scope, id), {
			formatVersion: 1,
			entries: [{ id, name, aliases: [], status: 'confirmed' }],
		})
	}
	await project.write(projectFiles.assetRegistry({ level: 'series' }), {
		formatVersion: 1,
		entries: [
			{
				id: 'room/dusk',
				type: 'location',
				path: 'assets/room.png',
				aliases: [],
				status: 'drawn',
			},
			{
				id: 'traveler/coat/calm',
				type: 'expression',
				path: 'assets/traveler.png',
				aliases: [],
				status: 'drawn',
			},
		],
	})
	await project.writeFile('assets/room.png', background)
	await project.writeFile('assets/traveler.png', sprite)
}
