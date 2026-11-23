import { projectFiles, type VolumeDigest } from '@novelive/format/model'
import type { Project } from '../../project'
import { optionalFile } from '../../project/series/resolve'
import {
	type PrepareVolumeOptions,
	prepareVolume,
} from '../../project-pipeline'
import { withUsage } from '../../usage'
import { BibleChangedDuringSynthesisError } from '../index'

export async function prepareSeries(
	project: Project,
	options: PrepareVolumeOptions & {
		skipVolume?: (volumeId: string) => Promise<boolean>
		onReady?: (
			volumeId: string,
			result: Awaited<ReturnType<typeof prepareVolume>>,
		) => void | Promise<void>
	},
) {
	const series = await project.read(projectFiles.series)
	const previousDigests: VolumeDigest[] = []
	for (const volumeId of series.volumeIds) {
		options.signal?.throwIfAborted()
		const skip = await options.skipVolume?.(volumeId)
		const volume = await project.read(projectFiles.volume(volumeId))
		const prepare = async () => {
			for (let attempt = 0; ; attempt++) {
				try {
					return await prepareVolume(project, volumeId, {
						...options,
						previousDigests: [...previousDigests],
						incremental: series.volumeIds.indexOf(volumeId) > 0,
					})
				} catch (error) {
					if (
						!(error instanceof BibleChangedDuringSynthesisError) ||
						attempt >= 2
					)
						throw error
					options.signal?.throwIfAborted()
				}
			}
		}
		const result = skip
			? undefined
			: volume.workIds.length
				? await withUsage(project, volume.workIds[0], 'synthesize', prepare)
				: await prepare()
		const digest = await optionalFile(() =>
			project.read(projectFiles.digest(volumeId)),
		)
		if (digest) previousDigests.push(digest)
		if (result) await options.onReady?.(volumeId, result)
	}
}
