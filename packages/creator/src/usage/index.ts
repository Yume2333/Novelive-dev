import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Usage } from '@earendil-works/pi-ai'
import { projectFiles } from '@novelive/format/model'
import type { TextSlot } from '../config/schema'
import type { CommandOutput } from '../contract'
import type { ProductionUsage } from '../contract/queue'
import { Project } from '../project'

type Phase = ProductionUsage['phase']
const context = new AsyncLocalStorage<{
	project: Project
	workId: string
	phase: Phase
}>()

export function withUsage<T>(
	project: Project,
	workId: string,
	phase: Phase,
	action: () => T,
): T {
	if (
		!project.database
			.prepare('SELECT 1 FROM work WHERE work_id = ?')
			.get(workId)
	)
		return action()
	return context.run({ project, workId, phase }, action)
}

export function usagePhase<T>(phase: Phase, action: () => T): T {
	const current = context.getStore()
	return current ? context.run({ ...current, phase }, action) : action()
}

export function usageMethods<T extends object>(
	target: T,
	project: Project,
	workId: string,
	phase: Phase,
): T {
	return new Proxy(target, {
		get(object, key, receiver) {
			const value = Reflect.get(object, key, receiver)
			if (typeof value !== 'function') return value
			return (...args: unknown[]) =>
				withUsage(
					project,
					workId,
					key === 'write' ||
						key === 'review' ||
						key === 'stage' ||
						key === 'draw'
						? key
						: phase,
					() => Reflect.apply(value, object, args),
				)
		},
	})
}

export function recordTextUsage(
	model: string,
	usage: Usage,
	slot: TextSlot = 'main',
) {
	const current = context.getStore()
	if (!current) return
	const { project, workId, phase } = current
	project.database
		.prepare(`INSERT INTO usage
		(usage_id, work_id, at, slot, purpose, model, usage_input, usage_output, usage_cache_read, usage_cache_write)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.run(
			randomUUID(),
			workId,
			Date.now(),
			slot,
			phase,
			model,
			usage.input,
			usage.output,
			usage.cacheRead,
			usage.cacheWrite,
		)
}

export function recordImageUsage(model: string, imageCount: number) {
	const current = context.getStore()
	if (!current || !imageCount) return
	const { project, workId, phase } = current
	project.database
		.prepare(`INSERT INTO usage
		(usage_id, work_id, at, slot, purpose, model, image_count)
		VALUES (?, ?, ?, 'image', ?, ?, ?)`)
		.run(randomUUID(), workId, Date.now(), phase, model, imageCount)
}

export async function listUsage(
	dataDir: string,
): Promise<CommandOutput<'usage.list'>> {
	const result: CommandOutput<'usage.list'> = {
		records: [],
		staleAssets: [],
		unreadableProjects: [],
	}
	let names: string[]
	try {
		names = await readdir(join(dataDir, 'projects'))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
		throw error
	}
	const directories = new Set<string>()
	for (const name of names) {
		try {
			const directory = await readFile(join(dataDir, 'projects', name), 'utf8')
			if (directories.has(directory)) continue
			const history = await projectUsage(directory)
			directories.add(directory)
			result.records.push(...history.records)
			result.staleAssets.push(...history.staleAssets)
		} catch (error) {
			result.unreadableProjects.push({
				projectId: name,
				reason:
					(error as NodeJS.ErrnoException).code === 'ENOENT'
						? '项目已移动或不存在'
						: '项目无法读取',
			})
		}
	}
	result.records.sort((a, b) => b.usage.at - a.usage.at)
	return result
}

async function projectUsage(directory: string) {
	const result: Pick<CommandOutput<'usage.list'>, 'records' | 'staleAssets'> = {
		records: [],
		staleAssets: [],
	}
	using project = await Project.open(directory)
	const series = await project.read(projectFiles.series)
	for (const volumeId of series.volumeIds) {
		const volume = await project.read(projectFiles.volume(volumeId))
		for (const workId of volume.workIds) {
			const link = { seriesId: series.seriesId, volumeId, workId }
			const rows = project.database
				.prepare('SELECT * FROM usage WHERE work_id = ? ORDER BY at, usage_id')
				.all(workId)
			for (const row of rows) {
				const common = {
					link,
					at: Number(row.at),
					phase: row.purpose as Phase,
					model: String(row.model),
					costUsd: row.cost_priced ? Number(row.cost_usd) : null,
				}
				result.records.push({
					id: String(row.usage_id),
					usage:
						row.image_count !== null
							? {
									...common,
									kind: 'image',
									imageCount: Number(row.image_count),
								}
							: {
									...common,
									kind: 'text',
									inputTokens: Number(row.usage_input),
									outputTokens: Number(row.usage_output),
									cacheReadTokens: Number(row.usage_cache_read),
									cacheWriteTokens: Number(row.usage_cache_write),
								},
				})
			}
			for (const row of project.database
				.prepare(
					"SELECT asset_key FROM asset WHERE work_id = ? AND status = 'stale' ORDER BY asset_key",
				)
				.all(workId))
				result.staleAssets.push({ workId, assetKey: String(row.asset_key) })
		}
	}
	return result
}
