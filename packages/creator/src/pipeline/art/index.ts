import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { arr, bool, obj, oneOf, opt, str } from '@earendil-works/pi-schema'
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
import { resolveRegistry, scopeLevels } from '../../project/series/resolve'
import type { ReplayOptions } from '../../replay'
import { SpendBudgetError } from '../../usage/spend'
import {
	checkVariantProfile,
	type Profile,
	postprocess,
	readProfiles,
	recordProfile,
} from '../postprocess'
import { MattingUnavailableError, removeBackground } from './background'
import { checkImage, type Dimensions, placeholder } from './check'
import type { CgReferences } from './director'
import { artJson, imageRenderer, type ModelOptions } from './models'
import { type ArtBible, type ArtJob, type ManifestItem, planArt } from './plan'
import { type Drawing, drawingPrompt, expressionPreservation } from './prompt'

export { directChapterArt } from './director'
export { type ArtBible, type ArtJob, type ManifestItem, planArt } from './plan'

type RegistryEntry = AssetRegistry['entries'][number]
type CostumeCandidateBudget = {
	opaqueStreak: number
	matting: { error?: MattingUnavailableError }
}
type ReviewCheckpoint = {
	path: string
	resume: boolean
}
type PaintContinuation =
	| { prompt: string; png: string }
	| { feedback: string; rewritten?: string; png?: string }
type PendingPaint = PaintContinuation & {
	settingsVersion: string
	attempt: number
	moderated: boolean
}
const opaqueCandidateLimit = 2
type PaintStop =
	| 'retries'
	| 'moderation'
	| 'reference'
	| 'matting'
	| 'unsupported'
	| 'provider-unsupported'
	| 'provider-outcome'
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
	imageGenerationReplay?: ReplayOptions
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
	styleReferenceFeedback: opt(str()),
})
const contentSchema = obj({ content: str({ minLength: 1 }) })

function hasTextOnlyCharacterStyle(drawing: Drawing) {
	return (
		drawing.kind === 'character' &&
		!drawing.references.some(({ role }) => role === 'identity')
	)
}

function generationReferenceFilter(drawing: Drawing) {
	const useStyle = !hasTextOnlyCharacterStyle(drawing)
	return ({ role }: Drawing['references'][number]) =>
		useStyle || role !== 'style'
}

function characterBriefFallback(
	character: Drawing['characters'][number] | undefined,
	costumeDescription: string | undefined,
) {
	if (
		!character ||
		!('description' in character) ||
		typeof character.description !== 'string'
	)
		return
	const { appearance } = character
	if (
		![
			costumeDescription,
			appearance?.description,
			...(appearance?.anchorFeatures ?? []),
			appearance?.keyColors?.hair,
			appearance?.keyColors?.eyes,
			appearance?.keyColors?.clothing,
		].some((value) => value?.trim())
	)
		return character.description
}

async function boundAuditImage(png: Buffer) {
	const image = sharp(png)
	const metadata = await image.metadata()
	let { width, height } = metadata
	const edge = 1536
	if (width > edge || height > edge) {
		const { data, info } = await image
			.resize({ width: edge, height: edge, fit: 'inside' })
			.png()
			.toBuffer({ resolveWithObject: true })
		png = data
		width = info.width
		height = info.height
	}
	return { png, width, height, hasAlpha: metadata.hasAlpha }
}

async function auditPreview(image: Buffer) {
	const { png, width, height, hasAlpha } = await boundAuditImage(image)
	if (!hasAlpha) return { png }
	const tile = Math.max(1, Math.round(Math.min(width, height) / 24))
	const checkerboard = Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="checker" width="${tile * 2}" height="${tile * 2}" patternUnits="userSpaceOnUse"><rect width="${tile * 2}" height="${tile * 2}" fill="#ddd"/><path d="M0 0h${tile}v${tile}H0z M${tile} ${tile}h${tile}v${tile}h-${tile}z" fill="#aaa"/></pattern></defs><rect width="100%" height="100%" fill="url(#checker)"/></svg>`,
	)
	return {
		png: await sharp(checkerboard)
			.composite([{ input: png }])
			.removeAlpha()
			.png()
			.toBuffer(),
		transparencyHint:
			'The gray checkerboard in Image 1 shows transparency; it is not part of the artwork.',
	}
}

const isMissing = (error: unknown) =>
	error instanceof Error && 'code' in error && error.code === 'ENOENT'
const moderationHint = '上一次生成被内容审核拒绝，请收敛描写'
const baseKeep = ['脸型', '发型', '瞳色', '服装', '姿势', '取景', '画风']
const registryWrites = new Map<string, Promise<unknown>>()
const isDrawnBase = ({ type, status }: RegistryEntry) =>
	status === 'drawn' && (type === 'character' || type === 'location')

export class ArtProduction {
	private render: ReturnType<typeof imageRenderer> | undefined
	private readonly registryFile
	private readonly scope: ProjectScope

	constructor(
		private readonly project: Project,
		private readonly options: Options,
	) {
		this.scope = options.scope ?? { level: 'series' }
		this.registryFile = projectFiles.assetRegistry(this.scope)
	}

	private scoped(path: string) {
		return this.registryFile.path.replace(/assets\/asset-registry\.json$/, path)
	}

	async registry(): Promise<AssetRegistry> {
		return resolveRegistry(this.project, this.options.readScope ?? this.scope)
	}

	private reviewPath(entry: RegistryEntry) {
		return this.scoped(
			`source/production/art/${createHash('sha256').update(entry.path).digest('hex')}.pending-review.json`,
		)
	}

	hasPendingReview(assetId: string) {
		const read = <T>(path: string): T | undefined => {
			try {
				return JSON.parse(readFileSync(join(this.project.root, path), 'utf8'))
			} catch (error) {
				if (isMissing(error)) return
				throw error
			}
		}
		for (const scope of scopeLevels(
			this.options.readScope ?? this.scope,
		).reverse()) {
			const registry = read<AssetRegistry>(
				projectFiles.assetRegistry(scope).path,
			)
			const entry = registry?.entries.find(({ id }) => id === assetId)
			if (!entry) continue
			const pending = read<PendingPaint>(this.reviewPath(entry))
			return (
				!!pending &&
				typeof pending.settingsVersion === 'string' &&
				'prompt' in pending &&
				typeof pending.prompt === 'string' &&
				!!pending.png
			)
		}
		return false
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
		resumingBudget = false,
	): Promise<ImageJobResult> {
		const pending = this.pendingDraws.get(job.assetId)
		if (pending) return pending
		const task = this.drawRegistered(
			job,
			bible,
			cg,
			undefined,
			resumingBudget,
		).finally(() => this.pendingDraws.delete(job.assetId))
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
		resumingBudget = false,
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
		const expression = job.kind === 'expression'
		const portrait = job.kind === 'character' || expression
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
		const costumeDescription = character?.costumes?.find(
			(item) => item.id === costume,
		)?.description
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
				expression ? undefined : costumeDescription,
				job.kind === 'location' ? location?.description : undefined,
				redraw?.instruction,
			]
				.filter(Boolean)
				.join('；'),
			characterDescriptionFallback: portrait
				? characterBriefFallback(
						character,
						expression ? undefined : costumeDescription,
					)
				: undefined,
			style: bible.style.description,
			references: expression ? [] : this.styleReferences(bible.style),
			characters: character ? [character] : [],
			keep: portrait
				? [
						...baseKeep,
						expression ? (costumeDescription ?? '') : '',
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
			false,
			undefined,
			redraw
				? undefined
				: {
						path: this.reviewPath(entry),
						resume: resumingBudget,
					},
		).catch((error: unknown) => {
			if (!(error instanceof MattingUnavailableError)) throw error
			return { issue: error.message, reason: 'matting_unavailable' } as const
		})
		if ('issue' in result) {
			if ('reason' in result) {
				return redraw
					? { status: 'unsupported', issue: result.issue }
					: this.savePlaceholder(entry.id, result.issue, result.reason)
			}
			const unsupported =
				result.stop === 'unsupported' || result.stop === 'provider-unsupported'
			return unsupported || redraw
				? {
						status: unsupported ? 'unsupported' : 'placeholder',
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
		candidateBudget?: CostumeCandidateBudget,
		checkpoint?: ReviewCheckpoint,
	) {
		this.render ??= imageRenderer(
			this.options.image,
			this.options,
			this.options.imageGenerationReplay,
		)
		const render = this.render
		const references = drawing.references.slice(0, 16)
		const auditRefs = await Promise.all(
			references.map(async (ref, i) => {
				const image = sharp(await this.project.readFile(ref.path))
				return (
					derived && i === 0 ? image.resize({ ...target, fit: 'fill' }) : image
				)
					.png()
					.toBuffer()
			}),
		)
		const auditDrawing = { ...drawing, references }
		const expression = drawing.kind === 'expression'
		const forGeneration = generationReferenceFilter(auditDrawing)
		const textOnlyStyle = hasTextOnlyCharacterStyle(auditDrawing)
		const refs = auditRefs.filter((_, index) =>
			forGeneration(references[index]),
		)
		const promptDrawing = {
			...drawing,
			references: references.filter(forGeneration),
		}
		const brief = [
			drawing.description,
			expression ? undefined : drawing.characterDescriptionFallback,
		]
			.filter(Boolean)
			.join('；')
		const painter = derived
			? this.options.fast
			: transparent
				? (this.options.portrait ?? this.options.main)
				: this.options.main
		let issue = '没有生成可用图片。'
		let feedback = ''
		let reviewed: Buffer | undefined
		let neededUnavailableMatting = false
		const stopped = (stop: PaintStop, message = issue) => ({
			issue: message,
			reviewed,
			stop,
			mainWouldOffer:
				!neededUnavailableMatting &&
				(stop === 'retries' || stop === 'moderation'),
		})
		let moderated = false
		let attempt = 0
		let rewritten: string | undefined
		const settingsVersion = checkpoint
			? createHash('sha256')
					.update(
						JSON.stringify([
							auditDrawing,
							target,
							transparent,
							derived,
							auditRefs.map((reference) =>
								createHash('sha256').update(reference).digest('hex'),
							),
						]),
					)
					.digest('hex')
			: ''
		const clearReview = async () => {
			if (checkpoint)
				await rm(join(this.project.root, checkpoint.path), { force: true })
		}
		const savePaint = async (next: PaintContinuation) => {
			if (!checkpoint) return
			const pending: PendingPaint = {
				settingsVersion,
				attempt,
				moderated,
				...next,
			}
			await this.project.writeFile(checkpoint.path, JSON.stringify(pending))
		}
		let boundedRefs: Promise<Buffer[]> | undefined
		const audit = async (
			png: Buffer,
			prompt: string,
			preview: Awaited<ReturnType<typeof auditPreview>>,
		) => {
			try {
				boundedRefs ??= Promise.all(
					auditRefs.map(
						async (reference) => (await boundAuditImage(reference)).png,
					),
				)
				const judge = await artJson(
					this.options.visual,
					prompt,
					auditSchema,
					this.options,
					[preview.png, ...(await boundedRefs)],
				)
				if (judge.pass && judge.failedChecks.length === 0) {
					await clearReview()
					return true
				}
				issue = feedback =
					judge.feedback || `视觉审核未通过：${judge.failedChecks.join('、')}`
				if (attempt <= this.options.image.retries)
					await savePaint({ feedback, png: png.toString('base64') })
				else await clearReview()
				return false
			} catch (error) {
				if (error instanceof SpendBudgetError)
					await savePaint({ prompt, png: png.toString('base64') })
				throw error
			}
		}
		if (checkpoint?.resume) {
			const saved = await this.file(checkpoint.path)
			if (saved) {
				const pending: PendingPaint = JSON.parse(saved.toString())
				if (pending.settingsVersion === settingsVersion) {
					attempt = pending.attempt
					moderated = pending.moderated
					if ('feedback' in pending) {
						issue = feedback = pending.feedback
						rewritten = pending.rewritten
						reviewed = pending.png
							? Buffer.from(pending.png, 'base64')
							: undefined
					} else {
						reviewed = Buffer.from(pending.png, 'base64')
						if (
							await audit(
								reviewed,
								pending.prompt,
								await auditPreview(reviewed),
							)
						)
							return { png: reviewed }
					}
				} else {
					await clearReview()
				}
			}
		} else {
			await clearReview()
		}
		while (attempt <= this.options.image.retries) {
			let content = rewritten
			if (content === undefined) {
				await savePaint({ feedback, png: reviewed?.toString('base64') })
				const rewrite = await artJson(
					painter,
					[
						'Write only visible content for the image; return JSON {"content":"..."}. Write positive factual prose, never negative prompts. Describe facial expression through brow, eye and mouth movements. For dark scenes use light, shadow and silhouettes. If moderation declined, omit graphic detail and use non-graphic visual atmosphere instead.',
						`${drawing.kind}: ${brief}`,
						expression
							? `Character preservation context (not part of the expression cue): ${expressionPreservation(drawing)}.`
							: undefined,
						feedback,
					]
						.filter(Boolean)
						.join('\n'),
					contentSchema,
					{ ...this.options, maxTokens: 1024 },
				)
				content = rewrite.content
				await savePaint({
					feedback,
					rewritten: content,
					png: reviewed?.toString('base64'),
				})
			}
			const describe = (
				firstReference: number,
				issue = '',
				input = promptDrawing,
			) => drawingPrompt(input, content, issue, firstReference)
			const result = await render(
				describe(1, feedback),
				refs,
				target,
				transparent,
			)
			rewritten = undefined
			feedback = ''
			if ('error' in result) {
				this.options.signal?.throwIfAborted()
				issue = result.error.message
				if (result.doNotRegenerate) return stopped('provider-outcome')
				if (result.error.code === 'unsupported')
					return stopped('provider-unsupported')
				if (result.error.code === 'moderation') {
					if (optionalReference && (result.referenceModerated || moderated))
						return stopped('reference')
					if (moderated) return stopped('moderation')
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
			let nativeTransparency: boolean | undefined
			let checked = await checkImage(result.bytes, target, {
				...checks,
				onTransparency: candidateBudget
					? (transparentEnough) => {
							nativeTransparency = transparentEnough
						}
					: undefined,
			})
			if (candidateBudget && nativeTransparency !== undefined) {
				candidateBudget.opaqueStreak = nativeTransparency
					? 0
					: candidateBudget.opaqueStreak + 1
				if (
					candidateBudget.matting.error &&
					candidateBudget.opaqueStreak >= opaqueCandidateLimit
				) {
					return stopped('matting', candidateBudget.matting.error.message)
				}
			}
			if ('issue' in checked && checked.unsupported) {
				let recovered: Buffer
				try {
					recovered = await removeBackground(result.bytes, this.options.signal)
				} catch (error) {
					this.options.signal?.throwIfAborted()
					if (error instanceof MattingUnavailableError) {
						if (candidateBudget) {
							neededUnavailableMatting = true
							candidateBudget.matting.error = error
							if (
								reviewed &&
								attempt <= this.options.image.retries &&
								candidateBudget.opaqueStreak < opaqueCandidateLimit
							) {
								feedback = issue
								continue
							}
							return stopped('matting', error.message)
						}
						throw error
					}
					return stopped('unsupported', checked.issue)
				}
				checked = await checkImage(recovered, target, checks)
			}
			if ('issue' in checked) {
				if (checked.unsupported) return stopped('unsupported', checked.issue)
				if (
					nativeTransparency === false &&
					candidateBudget?.matting.error &&
					attempt > this.options.image.retries
				)
					return stopped('matting', candidateBudget.matting.error.message)
				issue = feedback = checked.issue
				continue
			}
			reviewed = checked.png
			const preview = await auditPreview(checked.png)
			const passed = await audit(
				checked.png,
				[
					expression
						? 'Visually audit the first image. Image 2 is the accepted base. Check the requested facial expression against the saved cue (description); verify identity, anchors and key colors against the base and preservation context. Reject unintended changes outside the face, including pose, silhouette, framing, transparency, colors, shading and linework. Judge style only by preservation of the accepted base, not by matching any other look. Check for artifacts independently.'
						: 'Visually audit the first image. Compare identity against costume/base images, not unrelated style characters. Verify each anchor feature and key color, description and composition, style, and artifacts independently.',
					preview.transparencyHint,
					'Return JSON {"pass":boolean,"failedChecks":[],"feedback":"..."}. Valid failedChecks: identity, anchors, description, style, artifacts.',
					textOnlyStyle
						? `Judge the blocking style check only against this written style description: ${drawing.style}`
						: undefined,
					textOnlyStyle && refs.length < auditRefs.length
						? [
								...references.flatMap(({ role }, index) =>
									role === 'style'
										? [`Image ${index + 2} is a style reference only.`]
										: [],
								),
								'The painter cannot see the style images. Put differences that are not specified in the written style description in the optional styleReferenceFeedback string. Treat these as advisory only: they must not affect pass, failedChecks, or blocking feedback. Describe style differences and concrete corrections in words; do not refer to reference images by number.',
							].join(' ')
						: undefined,
					`Original image brief (verify independently of the painter's rewrite): ${brief}`,
					expression
						? `Character preservation context: ${expressionPreservation(drawing)}.`
						: describe(2, '', textOnlyStyle ? promptDrawing : auditDrawing),
				]
					.filter(Boolean)
					.join('\n'),
				preview,
			)
			if (passed) return checked
		}
		return stopped('retries')
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
		const matting: CostumeCandidateBudget['matting'] = {}
		const persistCandidate = async (
			path: string,
			png: Buffer,
			portrait: boolean,
		) => {
			const profile = await this.saveWebp(
				path,
				png,
				this.outputSize(portrait),
				this.configuredProfile(),
				true,
			)
			await this.writeRegistry(() => recordProfile(this.project, path, profile))
		}
		const style = bible.style.description
		const mainVisuals: Candidate[] = []
		for (const i of [1, 2, 3]) {
			const id = `visual-${i}`
			const path =
				i === 1 && creatorMainVisual
					? creatorMainVisual
					: cachePath(`candidates/style/${id}.webp`)
			if (path !== creatorMainVisual && !(await this.file(path))) {
				const result = await this.paint(
					{
						kind: 'main-visual',
						description: `构图候选 ${i}：${style}`,
						style,
						references: this.styleReferences(bible.style),
						characters: [],
						keep: [],
					},
					this.nativeSize(false),
					false,
				)
				const png =
					'png' in result
						? result.png
						: result.mainWouldOffer
							? result.reviewed
							: undefined
				if (!png)
					throw new Error(
						'issue' in result ? result.issue : '没有生成可用图片。',
					)
				await persistCandidate(path, png, false)
			}
			mainVisuals.push({ id, cachePath: path })
		}
		const characters: VisualCandidates['characters'] = []
		for (const character of bible.characters) {
			if (
				!character.major ||
				!character.firstSeenChapter ||
				!firstVolumeChapters.includes(character.firstSeenChapter)
			)
				continue
			const budget = {
				edit: { matting, opaqueStreak: 0 },
				generate: { matting, opaqueStreak: 0 },
			}
			const illustration = illustrations?.get(character.id)
			const illustrationKey = illustration
				? createHash('sha256')
						.update(await this.project.readFile(illustration.cachePath))
						.digest('hex')
				: undefined
			for (const costume of character.costumes ?? []) {
				const candidates: Candidate[] = []
				let fallback: (Candidate & { png?: Buffer }) | undefined
				let failure: Error | undefined
				const collect = async (
					id: string,
					drawing: Drawing,
					path: string,
					optionalReference = false,
				) => {
					if (await this.file(path)) {
						candidates.push({ id, cachePath: path })
						return true
					}
					const fallbackPath = path.replace(/\.webp$/, '-fallback.webp')
					if (await this.file(fallbackPath)) {
						fallback ??= { id, cachePath: fallbackPath }
						return false
					}
					const usesEdit = drawing.references.some(
						generationReferenceFilter(drawing),
					)
					const mode = usesEdit ? budget.edit : budget.generate
					if (mode.matting.error && mode.opaqueStreak >= opaqueCandidateLimit)
						return false
					const result = await this.paint(
						drawing,
						this.nativeSize(true),
						true,
						false,
						optionalReference,
						mode,
					)
					if ('issue' in result) {
						if (result.stop === 'provider-unsupported')
							throw new Error(result.issue)
						if (
							result.stop !== 'reference' &&
							result.stop !== 'matting' &&
							!(result.stop === 'moderation' && matting.error)
						)
							failure ??= new Error(result.issue)
					}
					const retained = 'png' in result ? result.png : result.reviewed
					if (!retained) return false
					if ('issue' in result && !result.mainWouldOffer) {
						fallback ??= { id, cachePath: fallbackPath, png: retained }
						return false
					}
					await persistCandidate(path, retained, true)
					candidates.push({ id, cachePath: path })
					return true
				}
				const references = this.styleReferences(bible.style)
				const designReference = characterDesignReference(character)
				if (designReference) references.push(designReference)
				for (const i of [1, 2, 3]) {
					const drawing: Drawing = {
						kind: 'character',
						description: `造型候选 ${i}：${costume.description}`,
						characterDescriptionFallback: characterBriefFallback(
							character,
							costume.description,
						),
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
						const saved = await collect(
							'costume-epub',
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
						if (saved) continue
					}
					const id = `costume-${i}`
					const path = cachePath(`${directory}/${id}.webp`)
					await collect(id, drawing, path)
				}
				if (!candidates.length && fallback) {
					const { id, cachePath, png } = fallback
					if (png) await persistCandidate(cachePath, png, true)
					candidates.push({ id, cachePath })
				}
				if (!candidates.length && failure) throw failure
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
			...(matting.error ? { mattingUnavailable: true } : {}),
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
