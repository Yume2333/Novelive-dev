import type { CommandOutput } from '@novelive/creator/contract'
import { scoped } from '../../i18n'

const t = scoped('import')

export type ImportLayout = Extract<
	CommandOutput<'import.txt'>,
	{ status: 'ready' }
>['layout']

const shift = (layout: ImportLayout, from: number, by: number) =>
	layout.volumes.map((volume) =>
		volume.start > from ? { ...volume, start: volume.start + by } : volume,
	)

/** Moves the boundary at the end of a volume by whole chapters, keeping every volume non-empty. */
export function nudgeVolume(
	layout: ImportLayout,
	index: number,
	delta: number,
	chapters: number,
): ImportLayout {
	if (index < 0 || index >= layout.volumes.length - 1) return layout
	const boundary = layout.volumes[index + 1].start
	const end = layout.volumes[index + 2]?.start ?? chapters
	const next = boundary + delta
	if (next <= layout.volumes[index].start || next >= end) return layout
	return {
		...layout,
		volumes: layout.volumes.map((volume, i) =>
			i === index + 1 ? { ...volume, start: next } : volume,
		),
	}
}

export const chapterLength = (
	layout: ImportLayout,
	index: number,
	paragraphs: number,
) =>
	(layout.chapters[index + 1]?.start ?? paragraphs) -
	layout.chapters[index].start

export const isVolumeStart = (layout: ImportLayout, index: number) =>
	layout.volumes.some((volume) => volume.start === index)

export function renameChapter(
	layout: ImportLayout,
	index: number,
	title: string,
): ImportLayout {
	return {
		...layout,
		chapters: layout.chapters.map((chapter, i) =>
			i === index ? { ...chapter, title } : chapter,
		),
	}
}

/** Joins a chapter onto the one before it inside the same volume. */
export function mergeChapter(
	layout: ImportLayout,
	index: number,
): ImportLayout {
	if (index === 0 || isVolumeStart(layout, index)) return layout
	return {
		...layout,
		chapters: layout.chapters.filter((_, i) => i !== index),
		volumes: shift(layout, index, -1),
	}
}

/** Splits a chapter at its middle paragraph. */
export function splitChapter(
	layout: ImportLayout,
	index: number,
	paragraphs: number,
): ImportLayout {
	const length = chapterLength(layout, index, paragraphs)
	if (length < 2) return layout
	const chapter = layout.chapters[index]
	const next = {
		title: t('{{title}}（续）', { title: chapter.title }),
		start: chapter.start + Math.floor(length / 2),
	}
	return {
		...layout,
		chapters: layout.chapters.toSpliced(index + 1, 0, next),
		volumes: shift(layout, index, 1),
	}
}

export function startVolume(layout: ImportLayout, index: number): ImportLayout {
	if (index === 0 || isVolumeStart(layout, index)) return layout
	const volumes = [
		...layout.volumes,
		{
			title: t('第 {{value}} 卷', { value: layout.volumes.length + 1 }),
			start: index,
		},
	].sort((a, b) => a.start - b.start)
	return { ...layout, volumes }
}

export function renameVolume(
	layout: ImportLayout,
	index: number,
	title: string,
): ImportLayout {
	return {
		...layout,
		volumes: layout.volumes.map((volume, i) =>
			i === index ? { ...volume, title } : volume,
		),
	}
}

export function mergeVolume(layout: ImportLayout, index: number): ImportLayout {
	if (index === 0) return layout
	return { ...layout, volumes: layout.volumes.filter((_, i) => i !== index) }
}
