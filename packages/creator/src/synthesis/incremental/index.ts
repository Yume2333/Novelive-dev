import { projectFiles, type VolumeDigest } from '@novelive/format/model'
import type { Project } from '../../project'
import { optionalFile } from '../../project/series/resolve'
import {
	type PrepareVolumeOptions,
	prepareVolume,
} from '../../project-pipeline'

export async function prepareSeries(
	project: Project,
	options: PrepareVolumeOptions & {
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
		const result = await prepareVolume(project, volumeId, {
			...options,
			previousDigests: [...previousDigests],
			incremental: true,
		})
		const digest = await optionalFile(() =>
			project.read(projectFiles.digest(volumeId)),
		)
		if (digest) previousDigests.push(digest)
		await options.onReady?.(volumeId, result)
	}
}
