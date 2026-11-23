import { createHash } from 'node:crypto'
import { arr, bool, obj, oneOf, str } from '@earendil-works/pi-schema'
import {
	type AssetRegistry,
	type ChapterRef,
	type ImageJobResult,
	type ProjectScope,
	projectFiles,
	type Style,
} from '@novelive/format/model'
import sharp from 'sharp'
import { type ImageConfig, imageProvider, imageSize } from '../../models/image'
import type { TextConnection } from '../../models/text'
import type { Project } from '../../project'
import { entryOwner, persistOwnedEntries } from '../../project/series/ownership'
import { resolveRegistry } from '../../project/series/resolve'
import {
	checkVariantProfile,
	type Profile,
	postprocess,
	readProfiles,
	recordProfile,
} from '../postprocess'
import { MattingUnavailableError, removeBackground } from './background'
import {
	checkImage,
	type Dimensions,
	derivedFrameIssue,
	placeholder,
	spriteFrameIssue,
} from './check'
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
	mattingUnavailable?: true
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
	portrait?: TextConnection
	fast: TextConnection
	visual: TextConnection
	scope?: ProjectScope
	readScope?: ProjectScope
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
const registryWrites = new Map<string, Promise<unknown>>()
const isDrawnBase = ({ type, status }: RegistryEntry) =>
	status === 'drawn' && (type === 'character' || type === 'location')

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
		return resolveRegistry(this.project, this.options.readScope ?? this.scope)
	}

	private async persistRegistry(registry: AssetRegistry) {
		await persistOwnedEntries(
			this.project,
			this.options.readScope ?? this.scope,
			this.scope,
			projectFiles.assetRegistry,
			registry.entries,
		)
	}

	async register(
		items: readonly ManifestItem[],
		bible: ArtBible,
		merges?: Readonly<Record<string, string>>,
		chapter?: ChapterRef,
		beforeCommit?: (plan: ReturnType<typeof planArt>) => Promise<void>,
	) {
		return this.writeRegistry(async () => {
			const previous = await this.registry()
			const plan = planArt(items, bible, previous, merges)
			const existing = new Set(previous.entries.map((entry) => entry.id))
			for (const entry of plan.registry.entries)
				if (!existing.has(entry.id)) entry.path = this.scoped(entry.path)
			await beforeCommit?.(plan)
			await this.persistRegistry(plan.registry)
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

	private async update(
		id: string,
		status: RegistryEntry['status'],
		mattingUnavailableIssue?: string,
	) {
		const registry = await this.registry()
		const entry = registry.entries.find((item) => item.id === id)
		if (!entry) throw new Error(`Unregistered asset: ${id}`)
		entry.status = status
		if (mattingUnavailableIssue)
			entry.mattingUnavailableIssue = mattingUnavailableIssue
		else delete entry.mattingUnavailableIssue
		await this.persistRegistry(registry)
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

	private saveStatus(id: string, status: RegistryEntry['status']) {
		return this.writeRegistry(() => this.update(id, status))
	}

	private writeRegistry<T>(operation: () => Promise<T>) {
		const key = this.project.root
		const previous = registryWrites.get(key)
		const task = previous ? previous.then(operation, operation) : operation()
		registryWrites.set(key, task)
		const clear = () => {
			if (registryWrites.get(key) === task) registryWrites.delete(key)
		}
		void task.then(clear, clear)
		return task
	}

	async savePlaceholder(
		id: string,
		issue: string,
		reason?: 'matting_unavailable',
	): Promise<Extract<ImageJobResult, { status: 'placeholder' }>> {
		const entry = (await this.registry()).entries.find((item) => item.id === id)
		if (!entry) throw new Error(`Unregistered asset: ${id}`)
		const family =
			entry.type === 'character' || entry.type === 'expression'
				? 'character'
				: entry.type === 'cg'
					? 'cg'
					: 'location'
		const bytes = await placeholder(family)
		this.options.signal?.throwIfAborted()
		await this.project.writeFile(entry.path, bytes)
		await this.writeRegistry(() =>
			this.update(entry.id, 'placeholder', reason ? issue : undefined),
		)
		return { status: 'placeholder', issue, ...(reason ? { reason } : {}) }
	}

	redraw(
		job: ArtJob,
		bible: ArtBible,
		cg: CgReferences | undefined,
		target: { path: string; instruction?: string },
	) {
		return this.drawRegistered(job, bible, cg, target)
	}

	adopt(id: string, source: string) {
		return this.writeRegistry(async () => {
			const registry = await this.registry()
			const entry = registry.entries.find((item) => item.id === id)
			if (!entry) throw new Error(`Unregistered asset: ${id}`)
			const profiles = await readProfiles(this.project)
			const profile = profiles[source]?.profile ?? this.resizeProfile()
			if (isDrawnBase(entry))
				checkVariantProfile(
					profiles[entry.path]?.profile ?? this.resizeProfile(),
					profile,
				)
			await this.project.writeFile(
				entry.path,
				await this.project.readFile(source),
			)
			await recordProfile(this.project, entry.path, profile)
			entry.status = 'drawn'
			delete entry.mattingUnavailableIssue
			await this.persistRegistry(registry)
			return entry.path
		})
	}

	private async drawRegistered(
		job: ArtJob,
		bible: ArtBible,
		cg?: CgReferences,
		redraw?: { path: string; instruction?: string },
	): Promise<ImageJobResult> {
		const signal = this.options.signal
		signal?.throwIfAborted()
		const { entries } = await this.registry()
		const entry = entries.find((item) => item.id === job.assetId)
		if (!entry) throw new Error(`Unregistered asset: ${job.assetId}`)
		if (!redraw && (await this.file(entry.path))) {
			if (entry.status === 'placeholder')
				return entry.mattingUnavailableIssue
					? {
							status: 'placeholder',
							issue: entry.mattingUnavailableIssue,
							reason: 'matting_unavailable',
						}
					: { status: 'placeholder', issue: '需要处理：此前绘制失败。' }
			if (entry.status === 'pending') await this.saveStatus(entry.id, 'drawn')
			return { status: 'drawn' }
		}
		const portrait = job.kind === 'character' || job.kind === 'expression'
		const target = this.nativeSize(portrait)
		const foundBase =
			'baseAssetId' in job
				? entries.find((item) => item.id === job.baseAssetId)
				: undefined
		const base =
			foundBase?.status === 'drawn'
				? await this.file(foundBase.path)
				: undefined
		if ('baseAssetId' in job && (!base || !foundBase))
			return redraw
				? { status: 'placeholder', issue: '基准图未成功生成。' }
				: this.savePlaceholder(entry.id, '基准图未成功生成。')
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
				redraw?.instruction,
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
		const result = await this.paint(
			drawing,
			target,
			portrait,
			Boolean(base),
		).catch((error: unknown) => {
			if (!(error instanceof MattingUnavailableError)) throw error
			return { issue: error.message, reason: 'matting_unavailable' } as const
		})
		if ('issue' in result) {
			if ('reason' in result) {
				return redraw
					? {
							status: 'placeholder',
							issue: result.issue,
							reason: result.reason,
						}
					: this.savePlaceholder(entry.id, result.issue, result.reason)
			}
			return result.unsupported || redraw
				? {
						status: result.unsupported ? 'unsupported' : 'placeholder',
						issue: result.issue,
					}
				: this.savePlaceholder(entry.id, result.issue)
		}
		const profileSource =
			foundBase ?? (redraw && isDrawnBase(entry) ? entry : undefined)
		const profile = profileSource
			? ((await readProfiles(this.project))[profileSource.path]?.profile ??
				this.resizeProfile())
			: this.configuredProfile()
		const path = redraw?.path ?? entry.path
		const applied = await this.saveWebp(
			path,
			result.png,
			output,
			profile,
			!profileSource,
		)
		await this.writeRegistry(async () => {
			await recordProfile(this.project, path, applied)
			if (!redraw) await this.update(entry.id, 'drawn')
		})
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

	private configuredProfile(): Profile {
		return {
			mode: this.options.image.postProcess,
			tier: this.options.image.upscaleTier,
		}
	}

	private resizeProfile(): Profile {
		return { mode: 'off', tier: this.options.image.upscaleTier }
	}

	private async saveWebp(
		path: string,
		png: Buffer,
		size: Dimensions,
		profile: Profile,
		allowFallback = false,
	) {
		const target = { width: size.width, height: size.height }
		let image = sharp(png)
		let applied = profile
		if (profile.mode !== 'off') {
			try {
				image = sharp(
					await postprocess(
						png,
						{ ...profile, target, fit: 'cover' },
						{ signal: this.options.signal },
					),
				)
			} catch (error) {
				this.options.signal?.throwIfAborted()
				if (!allowFallback) throw error
				applied = { ...profile, mode: 'off' }
			}
		}
		if (applied.mode === 'off')
			image.resize({ ...target, fit: 'cover', kernel: 'lanczos3' })
		const bytes = await image
			.webp({ quality: 90, lossless: this.options.lossless })
			.toBuffer()
		this.options.signal?.throwIfAborted()
		await this.project.writeFile(path, bytes)
		return applied
	}

	private async paint(
		drawing: Drawing,
		target: Dimensions,
		transparent: boolean,
		derived = false,
		optionalReference = false,
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
		const painter = derived
			? this.options.fast
			: transparent
				? (this.options.portrait ?? this.options.main)
				: this.options.main
		let issue = '没有生成可用图片。'
		let feedback = ''
		let reviewed: Buffer | undefined
		let moderated = false
		let attempt = 0
		let baseOnly = false
		while (attempt <= this.options.image.retries) {
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
			const editReferences = baseOnly ? refs.slice(0, 1) : refs
			const describe = (firstReference: number, issue = '') =>
				baseOnly
					? `Edit only the brows, eyes and mouth of Image ${firstReference}: ${content.content} ${issue} Use the base as the exact canvas, including the transparent background. Keep the pose, hair, silhouette, position and scale pixel-aligned outside the face.`
					: drawingPrompt(promptDrawing, content.content, issue, firstReference)
			const result = await this.render(
				describe(1, feedback),
				editReferences,
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
					if (optionalReference && (result.referenceModerated || moderated))
						return { issue, moderated: true } as const
					if (moderated) break
					moderated = true
					feedback = moderationHint
					continue
				}
				attempt++
				continue
			}
			attempt++
			const checks = {
				transparent,
				base: derived ? refs[0] : undefined,
				variant: drawing.kind === 'variant',
			}
			let checked = await checkImage(result.bytes, target, checks)
			if ('issue' in checked && checked.unsupported) {
				let recovered: Buffer
				try {
					recovered = await removeBackground(result.bytes, this.options.signal)
				} catch (error) {
					this.options.signal?.throwIfAborted()
					if (error instanceof MattingUnavailableError) throw error
					return checked
				}
				checked = await checkImage(recovered, target, checks)
			}
			if ('issue' in checked) {
				if (checked.unsupported) return checked
				if (
					drawing.kind === 'expression' &&
					(checked.issue === spriteFrameIssue ||
						checked.issue === derivedFrameIssue)
				)
					baseOnly = true
				issue = feedback = checked.issue
				continue
			}
			const judge = await artJson(
				this.options.visual,
				[
					'Visually audit the first image. Compare identity against costume/base images, not unrelated style characters. Verify each anchor feature and key color, description and composition, style, and artifacts independently.',
					'Return JSON {"pass":boolean,"failedChecks":[],"feedback":"..."}. Valid failedChecks: identity, anchors, description, style, artifacts.',
					`Original image brief (verify independently of the painter's rewrite): ${drawing.description}`,
					describe(2),
				].join('\n'),
				auditSchema,
				this.options,
				[checked.png, ...editReferences],
			)
			if (judge.pass && judge.failedChecks.length === 0) return checked
			reviewed = checked.png
			issue = feedback =
				judge.feedback || `视觉审核未通过：${judge.failedChecks.join('、')}`
		}
		return { issue, reviewed }
	}

	async candidates(
		bible: ArtBible,
		firstVolumeChapters: readonly string[],
		creatorMainVisual?: string,
		supplemental: Candidate[] = [],
		illustrations?: ReadonlyMap<string, Candidate>,
	): Promise<VisualCandidates> {
		const styleScope = await entryOwner(
			this.project,
			this.options.readScope ?? this.scope,
			this.scope,
			projectFiles.style,
			bible.style.id,
		)
		const cachePath = (path: string) =>
			projectFiles.style(styleScope).path.replace('bible/style.json', path)
		const saveCandidate = async (
			drawing: Drawing,
			path: string,
			portrait: boolean,
			optionalReference = false,
		) => {
			if (!(await this.file(path))) {
				const result = await this.paint(
					drawing,
					this.nativeSize(portrait),
					portrait,
					false,
					optionalReference,
				)
				let png: Buffer
				if ('issue' in result) {
					if ('moderated' in result) return false
					if (!('reviewed' in result) || !result.reviewed)
						throw new Error(result.issue)
					png = result.reviewed
				} else {
					png = result.png
				}
				const profile = await this.saveWebp(
					path,
					png,
					this.outputSize(portrait),
					this.configuredProfile(),
					true,
				)
				await this.writeRegistry(() =>
					recordProfile(this.project, path, profile),
				)
			}
			return true
		}
		const candidate = async (
			id: string,
			drawing: Drawing,
			path: string,
			portrait = false,
		) => {
			await saveCandidate(drawing, path, portrait)
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
							cachePath(`candidates/style/${id}.webp`),
						),
			)
		}
		const characters: VisualCandidates['characters'] = []
		let mattingUnavailable: true | undefined
		const saveCostumeCandidate = async (
			drawing: Drawing,
			path: string,
			optionalReference = false,
		) => {
			try {
				return await saveCandidate(drawing, path, true, optionalReference)
			} catch (error) {
				if (!(error instanceof MattingUnavailableError)) throw error
				mattingUnavailable = true
				return false
			}
		}
		for (const character of bible.characters) {
			if (
				!character.major ||
				!character.firstSeenChapter ||
				!firstVolumeChapters.includes(character.firstSeenChapter)
			)
				continue
			const illustration = illustrations?.get(character.id)
			const illustrationKey = illustration
				? createHash('sha256')
						.update(await this.project.readFile(illustration.cachePath))
						.digest('hex')
				: undefined
			for (const costume of character.costumes ?? []) {
				const candidates: Candidate[] = []
				const references = this.styleReferences(bible.style)
				const designReference = characterDesignReference(character)
				if (designReference) references.push(designReference)
				for (const i of [1, 2, 3]) {
					const drawing: Drawing = {
						kind: 'character',
						description: `造型候选 ${i}：${costume.description}`,
						style,
						references,
						characters: [character],
						keep: [],
					}
					const directory = `candidates/characters/${character.id}/${costume.id}`
					if (i === 1 && illustration) {
						const path = cachePath(
							`${directory}/costume-epub-${illustrationKey}.webp`,
						)
						const saved = await saveCostumeCandidate(
							{
								...drawing,
								references: [
									...this.styleReferences(bible.style),
									{
										role: 'identity',
										path: illustration.cachePath,
										label: `${character.id} EPUB character design reference`,
									},
								],
							},
							path,
							true,
						)
						if (saved) {
							candidates.push({ id: 'costume-epub', cachePath: path })
							continue
						}
					}
					const id = `costume-${i}`
					const path = cachePath(`${directory}/${id}.webp`)
					if (await saveCostumeCandidate(drawing, path))
						candidates.push({ id, cachePath: path })
				}
				if (candidates.length)
					characters.push({
						characterId: character.id,
						costumeId: costume.id,
						candidates,
					})
			}
		}
		return {
			mainVisuals,
			characters,
			supplemental,
			...(mattingUnavailable ? { mattingUnavailable } : {}),
		}
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
			selection.supplementalIds.includes(selection.mainVisualId) ||
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
		const styleScope = await entryOwner(
			this.project,
			this.options.readScope ?? this.scope,
			this.scope,
			projectFiles.style,
			style.id,
		)
		for (const [i, source] of [main, ...supplemental].entries()) {
			const path = projectFiles
				.style(styleScope)
				.path.replace(
					'bible/style.json',
					i === 0
						? 'assets/style/main-visual.webp'
						: `assets/style/supplemental-${i}.webp`,
				)
			await this.saveWebp(
				path,
				await this.project.readFile(source),
				this.outputSize(false),
				this.resizeProfile(),
			)
			await this.writeRegistry(async () => {
				const profile = (await readProfiles(this.project))[source]?.profile
				await recordProfile(this.project, path, profile ?? this.resizeProfile())
			})
			references.push({
				path,
				description: i === 0 ? '主视觉' : '补充画风参考',
			})
		}
		await this.writeRegistry(async () => {
			const registry = await this.registry()
			const profiles = await readProfiles(this.project)
			for (const { id, path } of costumes) {
				const existing = registry.entries.find((entry) => entry.id === id)
				const destination =
					existing?.path ?? this.scoped(`assets/characters/${id}.webp`)
				await this.saveWebp(
					destination,
					await this.project.readFile(path),
					this.outputSize(true),
					this.resizeProfile(),
				)
				await recordProfile(
					this.project,
					destination,
					profiles[path]?.profile ?? this.resizeProfile(),
				)
				if (existing) {
					existing.status = 'drawn'
					delete existing.mattingUnavailableIssue
				} else
					registry.entries.push({
						id,
						path: destination,
						type: 'character',
						status: 'drawn',
						aliases: [],
					})
			}
			await this.persistRegistry(registry)
		})
		const chosen: Style = { ...style, status: 'confirmed', references }
		await this.writeRegistry(() =>
			persistOwnedEntries(
				this.project,
				this.options.readScope ?? this.scope,
				this.scope,
				projectFiles.style,
				[chosen],
			),
		)
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
