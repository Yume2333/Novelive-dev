import { arr, bool, obj, oneOf, str } from '@earendil-works/pi-schema'
import {
	type AssetRegistry,
	type ChapterRef,
	formatVersion,
	type ImageJobResult,
	type ProjectScope,
	projectFiles,
	type Style,
} from '@novelive/format/model'
import sharp from 'sharp'
import { type ImageConfig, imageProvider, imageSize } from '../../models/image'
import type { TextConnection } from '../../models/text'
import type { Project } from '../../project'
import { checkImage, type Dimensions, placeholder } from './check'
import type { CgReferences } from './director'
import { artJson, imageRenderer, type ModelOptions } from './models'
import { type ArtBible, type ArtJob, type ManifestItem, planArt } from './plan'
import { type Drawing, drawingPrompt } from './prompt'

export { directChapterArt } from './director'
export { type ArtBible, type ArtJob, type ManifestItem, planArt } from './plan'

type RegistryEntry = AssetRegistry['entries'][number]
type Candidate = { id: string; cachePath: string }
type VisualCandidates = {
	mainVisuals: Candidate[]
	characters: {
		characterId: string
		costumeId: string
		candidates: Candidate[]
	}[]
	supplemental: Candidate[]
}
type Options = ModelOptions & {
	image: ImageConfig
	main: TextConnection
	fast: TextConnection
	visual: TextConnection
	scope?: ProjectScope
	resolution?: '2K' | '4K'
	lossless?: boolean
}

const auditSchema = obj({
	pass: bool(),
	failedChecks: arr(
		oneOf(['identity', 'anchors', 'description', 'style', 'artifacts']),
		{ uniqueItems: true },
	),
	feedback: str(),
})
const contentSchema = obj({ content: str({ minLength: 1 }) })
const isMissing = (error: unknown) =>
	error instanceof Error && 'code' in error && error.code === 'ENOENT'
const moderationHint = '上一次生成被内容审核拒绝，请收敛描写'
const baseKeep = ['脸型', '发型', '瞳色', '服装', '姿势', '取景', '画风']

export class ArtProduction {
	private readonly render
	private readonly registryFile
	private readonly scope: ProjectScope

	constructor(
		private readonly project: Project,
		private readonly options: Options,
	) {
		this.scope = options.scope ?? { level: 'series' }
		this.registryFile = projectFiles.assetRegistry(this.scope)
		this.render = imageRenderer(options.image, options)
	}

	private scoped(path: string) {
		return this.registryFile.path.replace(/assets\/asset-registry\.json$/, path)
	}

	async registry(): Promise<AssetRegistry> {
		try {
			return await this.project.read(this.registryFile)
		} catch (error) {
			if (!isMissing(error)) throw error
			return { formatVersion, entries: [] }
		}
	}

	async register(
		items: readonly ManifestItem[],
		bible: ArtBible,
		merges?: Readonly<Record<string, string>>,
		chapter?: ChapterRef,
	) {
		return this.writeRegistry(async () => {
			const previous = await this.registry()
			const plan = planArt(items, bible, previous, merges)
			const existing = new Set(previous.entries.map((entry) => entry.id))
			for (const entry of plan.registry.entries)
				if (!existing.has(entry.id)) entry.path = this.scoped(entry.path)
			await this.project.write(this.registryFile, plan.registry)
			if (chapter) {
				const file = projectFiles.chapter(chapter)
				const metadata = await this.project.read(file)
				await this.project.write(file, { ...metadata, cg: plan.cg })
			}
			return plan.jobs
		})
	}

	private async file(path: string) {
		try {
			return await this.project.readFile(path)
		} catch (error) {
			if (!isMissing(error)) throw error
			return undefined
		}
	}

	private async update(id: string, status: RegistryEntry['status']) {
		const registry = await this.registry()
		const entry = registry.entries.find((item) => item.id === id)
		if (!entry) throw new Error(`Unregistered asset: ${id}`)
		entry.status = status
		await this.project.write(this.registryFile, registry)
	}

	private readonly pendingDraws = new Map<string, Promise<ImageJobResult>>()

	draw(
		job: ArtJob,
		bible: ArtBible,
		cg?: CgReferences,
	): Promise<ImageJobResult> {
		const pending = this.pendingDraws.get(job.assetId)
		if (pending) return pending
		const task = this.drawRegistered(job, bible, cg).finally(() =>
			this.pendingDraws.delete(job.assetId),
		)
		this.pendingDraws.set(job.assetId, task)
		return task
	}

	private registryWrite: Promise<void> = Promise.resolve()

	private saveStatus(id: string, status: RegistryEntry['status']) {
		return this.writeRegistry(() => this.update(id, status))
	}

	private writeRegistry<T>(operation: () => Promise<T>) {
		const task = this.registryWrite.then(operation)
		this.registryWrite = task.then(
			() => {},
			() => {},
		)
		return task
	}

	private async drawRegistered(
		job: ArtJob,
		bible: ArtBible,
		cg?: CgReferences,
	): Promise<ImageJobResult> {
		const signal = this.options.signal
		signal?.throwIfAborted()
		const { entries } = await this.registry()
		const entry = entries.find((item) => item.id === job.assetId)
		if (!entry) throw new Error(`Unregistered asset: ${job.assetId}`)
		if (await this.file(entry.path)) {
			if (entry.status === 'placeholder')
				return { status: 'placeholder', issue: '需要处理：此前绘制失败。' }
			if (entry.status === 'pending') await this.saveStatus(entry.id, 'drawn')
			return { status: 'drawn' }
		}
		const portrait = job.kind === 'character' || job.kind === 'expression'
		const family = portrait
			? 'character'
			: job.kind === 'cg'
				? 'cg'
				: 'location'
		const target = this.nativeSize(portrait)
		const foundBase =
			'baseAssetId' in job
				? entries.find((item) => item.id === job.baseAssetId)
				: undefined
		const base =
			foundBase?.status === 'drawn'
				? await this.file(foundBase.path)
				: undefined
		const fallback = async (issue: string): Promise<ImageJobResult> => {
			const bytes = await placeholder(family)
			signal?.throwIfAborted()
			await this.project.writeFile(entry.path, bytes)
			await this.saveStatus(entry.id, 'placeholder')
			return { status: 'placeholder', issue }
		}
		if ('baseAssetId' in job && (!base || !foundBase))
			return fallback('基准图未成功生成。')
		const [entity, costume] = job.assetId.split('/')
		const character = portrait
			? bible.characters.find((item) => item.id === entity)
			: undefined
		const location = bible.locations.find((item) => item.id === entity)
		const designReference = character && characterDesignReference(character)
		const priorCostume =
			job.kind === 'character'
				? entries
						.filter(
							(item) =>
								item.type === 'character' &&
								item.status === 'drawn' &&
								item.id.startsWith(`${entity}/`),
						)
						.at(-1)
				: undefined
		const drawing: Drawing = {
			kind: job.kind,
			description: [
				job.description,
				character?.costumes?.find((item) => item.id === costume)?.description,
				job.kind === 'location' ? location?.description : undefined,
			]
				.filter(Boolean)
				.join('；'),
			style: bible.style.description,
			references: this.styleReferences(bible.style),
			characters: character ? [character] : [],
			keep: portrait
				? [
						...baseKeep,
						character?.appearance?.description ?? '',
						...(character?.appearance?.anchorFeatures ?? []),
						...Object.values(character?.appearance?.keyColors ?? {}),
					].filter(Boolean)
				: ['地点布局', '物件位置', '镜头与透视', '画风'],
		}
		if (foundBase && base)
			drawing.references.unshift({
				role: 'base',
				path: foundBase.path,
				label: `${foundBase.id} base image`,
			})
		else if (designReference) drawing.references.push(designReference)
		else if (priorCostume)
			drawing.references.push({
				role: 'identity',
				path: priorCostume.path,
				label: `${priorCostume.id} previous costume base image`,
			})
		else if (job.kind === 'location' && location?.references?.[0])
			drawing.references.push({
				role: 'location',
				path: location.references[0].path,
				label: `${entity} location reference`,
			})
		for (const id of new Set(cg?.costumes ?? [])) {
			const ref = entries.find(
				(item) =>
					item.id === id &&
					item.type === 'character' &&
					item.status === 'drawn',
			)
			const cast = bible.characters.find((item) => item.id === id.split('/')[0])
			if (cast && !drawing.characters.includes(cast))
				drawing.characters = [...drawing.characters, cast]
			if (ref)
				drawing.references.push({
					role: 'identity',
					path: ref.path,
					label: `${id} costume base image`,
				})
		}
		const place = entries.find(
			(item) =>
				item.id === cg?.location &&
				item.type === 'location' &&
				item.status === 'drawn',
		)
		if (place)
			drawing.references.push({
				role: 'location',
				path: place.path,
				label: `${place.id} location base image`,
			})
		const output = base
			? await sharp(base).metadata()
			: this.outputSize(portrait)
		const result = await this.paint(drawing, target, portrait, Boolean(base))
		if ('issue' in result) {
			return result.unsupported
				? { status: 'unsupported', issue: result.issue }
				: fallback(result.issue)
		}
		await this.saveWebp(entry.path, result.png, output)
		await this.saveStatus(entry.id, 'drawn')
		return { status: 'drawn' }
	}

	private nativeSize(portrait: boolean) {
		const { model, baseUrl, nativeMaxEdge } = this.options.image
		return imageSize(imageProvider(baseUrl, model), nativeMaxEdge, portrait)
	}

	private outputSize(portrait: boolean): Dimensions {
		if (portrait) return { width: 2048, height: 3072 }
		return this.options.resolution === '4K'
			? { width: 3840, height: 2160 }
			: { width: 2560, height: 1440 }
	}

	private styleReferences(style: Style): Drawing['references'] {
		return (style.references ?? [])
			.slice(0, 3)
			.map(({ path, description }) => ({
				path,
				role: 'style',
				label: description,
			}))
	}

	private async saveWebp(path: string, png: Buffer, size: Dimensions) {
		const bytes = await sharp(png)
			.resize({ ...size, fit: 'cover', kernel: 'lanczos3' })
			.webp({ quality: 90, lossless: this.options.lossless })
			.toBuffer()
		this.options.signal?.throwIfAborted()
		await this.project.writeFile(path, bytes)
	}

	private async paint(
		drawing: Drawing,
		target: Dimensions,
		transparent: boolean,
		derived = false,
	) {
		const refs = await Promise.all(
			drawing.references.slice(0, 16).map(async (ref, i) => {
				const image = sharp(await this.project.readFile(ref.path))
				return (
					derived && i === 0 ? image.resize({ ...target, fit: 'fill' }) : image
				)
					.png()
					.toBuffer()
			}),
		)
		const promptDrawing = {
			...drawing,
			references: drawing.references.slice(0, refs.length),
		}
		const painter = derived ? this.options.fast : this.options.main
		let issue = '没有生成可用图片。'
		let feedback = ''
		let moderated = false
		for (
			let attempt = 0;
			attempt <= this.options.image.retries || feedback === moderationHint;
			attempt++
		) {
			const content = await artJson(
				painter,
				[
					'Write only visible content for the image; return JSON {"content":"..."}. Write positive factual prose, never negative prompts. Describe facial expression through brow, eye and mouth movements. For dark scenes use light, shadow and silhouettes. If moderation declined, omit graphic detail and use non-graphic visual atmosphere instead.',
					`${drawing.kind}: ${drawing.description}`,
					feedback,
				]
					.filter(Boolean)
					.join('\n'),
				contentSchema,
				this.options,
			)
			const result = await this.render(
				drawingPrompt(promptDrawing, content.content, feedback),
				refs,
				target,
				transparent,
			)
			feedback = ''
			if ('error' in result) {
				this.options.signal?.throwIfAborted()
				issue = result.error.message
				if (result.error.code === 'unsupported')
					return { issue, unsupported: true } as const
				if (result.error.code === 'moderation') {
					if (moderated) break
					moderated = true
					feedback = moderationHint
				}
				continue
			}
			const checked = await checkImage(result.bytes, target, {
				transparent,
				base: derived ? refs[0] : undefined,
				variant: drawing.kind === 'variant',
			})
			if ('issue' in checked) {
				if (checked.unsupported) return checked
				issue = feedback = checked.issue
				continue
			}
			const judge = await artJson(
				this.options.visual,
				[
					'Visually audit the first image. Compare identity against costume/base images, not unrelated style characters. Verify each anchor feature and key color, description and composition, style, and artifacts independently.',
					'Return JSON {"pass":boolean,"failedChecks":[],"feedback":"..."}. Valid failedChecks: identity, anchors, description, style, artifacts.',
					`Original image brief (verify independently of the painter's rewrite): ${drawing.description}`,
					drawingPrompt(promptDrawing, content.content, '', 2),
				].join('\n'),
				auditSchema,
				this.options,
				[checked.png, ...refs],
			)
			if (judge.pass && judge.failedChecks.length === 0) return checked
			issue = feedback =
				judge.feedback || `视觉审核未通过：${judge.failedChecks.join('、')}`
		}
		return { issue }
	}

	async candidates(
		bible: ArtBible,
		firstVolumeChapters: readonly string[],
		creatorMainVisual?: string,
		supplemental: Candidate[] = [],
	): Promise<VisualCandidates> {
		const candidate = async (
			id: string,
			drawing: Drawing,
			path: string,
			portrait = false,
		) => {
			if (!(await this.file(path))) {
				const result = await this.paint(
					drawing,
					this.nativeSize(portrait),
					portrait,
				)
				if ('issue' in result) throw new Error(result.issue)
				await this.saveWebp(path, result.png, this.outputSize(portrait))
			}
			return { id, cachePath: path }
		}
		const style = bible.style.description
		const mainVisuals: Candidate[] = []
		for (const i of [1, 2, 3]) {
			const id = `visual-${i}`
			mainVisuals.push(
				i === 1 && creatorMainVisual
					? { id, cachePath: creatorMainVisual }
					: await candidate(
							id,
							{
								kind: 'main-visual',
								description: `构图候选 ${i}：${style}`,
								style,
								references: this.styleReferences(bible.style),
								characters: [],
								keep: [],
							},
							this.scoped(`candidates/style/${id}.webp`),
						),
			)
		}
		const characters: VisualCandidates['characters'] = []
		for (const character of bible.characters) {
			if (
				!character.major ||
				!character.firstSeenChapter ||
				!firstVolumeChapters.includes(character.firstSeenChapter)
			)
				continue
			for (const costume of character.costumes ?? []) {
				const candidates: Candidate[] = []
				const references = this.styleReferences(bible.style)
				const designReference = characterDesignReference(character)
				if (designReference) references.push(designReference)
				for (const i of [1, 2, 3]) {
					const id = `costume-${i}`
					candidates.push(
						await candidate(
							id,
							{
								kind: 'character',
								description: `造型候选 ${i}：${costume.description}`,
								style,
								references,
								characters: [character],
								keep: [],
							},
							this.scoped(
								`candidates/characters/${character.id}/${costume.id}/${id}.webp`,
							),
							true,
						),
					)
				}
				characters.push({
					characterId: character.id,
					costumeId: costume.id,
					candidates,
				})
			}
		}
		return { mainVisuals, characters, supplemental }
	}

	async confirmVisual(
		style: Style,
		pool: VisualCandidates,
		selection: {
			mainVisualId: string
			supplementalIds: readonly string[]
			characters: readonly {
				characterId: string
				costumeId: string
				candidateId: string
			}[]
		},
	) {
		const find = (candidates: readonly Candidate[], id: string) => {
			const match = candidates.find((candidate) => candidate.id === id)
			if (!match) throw new Error(`Unknown visual candidate: ${id}`)
			return match.cachePath
		}
		if (
			selection.supplementalIds.length > 2 ||
			new Set(selection.supplementalIds).size !==
				selection.supplementalIds.length ||
			selection.characters.length !== pool.characters.length
		)
			throw new Error('Invalid visual selection')
		const main = find(pool.mainVisuals, selection.mainVisualId)
		const supplemental = selection.supplementalIds.map((id) =>
			find(pool.supplemental, id),
		)
		const costumes = pool.characters.map(
			({ characterId, costumeId, candidates }) => {
				const matches = selection.characters.filter(
					(item) =>
						item.characterId === characterId && item.costumeId === costumeId,
				)
				if (matches.length !== 1)
					throw new Error(`Select a candidate for ${characterId}/${costumeId}`)
				return {
					id: `${characterId}/${costumeId}/neutral`,
					path: find(candidates, matches[0].candidateId),
				}
			},
		)
		const references: NonNullable<Style['references']> = []
		for (const [i, source] of [main, ...supplemental].entries()) {
			const path = this.scoped(
				i === 0
					? 'assets/style/main-visual.webp'
					: `assets/style/supplemental-${i}.webp`,
			)
			await this.saveWebp(
				path,
				await this.project.readFile(source),
				this.outputSize(false),
			)
			references.push({
				path,
				description: i === 0 ? '主视觉' : '补充画风参考',
			})
		}
		const registry = await this.registry()
		for (const { id, path } of costumes) {
			const existing = registry.entries.find((entry) => entry.id === id)
			const destination =
				existing?.path ?? this.scoped(`assets/characters/${id}.webp`)
			await this.saveWebp(
				destination,
				await this.project.readFile(path),
				this.outputSize(true),
			)
			if (existing) existing.status = 'drawn'
			else
				registry.entries.push({
					id,
					path: destination,
					type: 'character',
					status: 'drawn',
					aliases: [],
				})
		}
		await this.project.write(this.registryFile, registry)
		const chosen: Style = { ...style, status: 'confirmed', references }
		const file = projectFiles.style(this.scope)
		let entries: Style[] = []
		try {
			entries = (await this.project.read(file)).entries
		} catch (error) {
			if (!isMissing(error)) throw error
		}
		await this.project.write(file, {
			formatVersion,
			entries: [...entries.filter((entry) => entry.id !== chosen.id), chosen],
		})
		return chosen
	}
}

function characterDesignReference(
	character: ArtBible['characters'][number],
): Drawing['references'][number] | undefined {
	const reference = character.references?.[0]
	if (reference)
		return {
			role: 'identity',
			path: reference.path,
			label: `${character.id} character design reference`,
		}
}
