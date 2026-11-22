import type {
	ChapterLink,
	DrawContext,
	DrawJob,
	ProductionTaskError,
	ProductionWorker,
	StepContext,
} from '../../../../packages/creator/src/scheduler/chapter'
import type {
	ImageJobResult,
	ImageQueueItem,
} from '../../../../packages/format/src/model'

type Outcome = ProductionTaskError | ImageJobResult

export class ScriptedWorker implements ProductionWorker {
	readonly calls: string[] = []
	readonly aborted: string[] = []
	readonly links = new Map<string, ChapterLink>()
	readonly desensitized: string[] = []
	readonly saved = new Set<string>()
	drawing = 0
	maxDrawing = 0
	private readonly gates = new Map<string, () => void>()
	private readonly held = new Map<string, Promise<void>>()
	private readonly outcomes = new Map<string, Outcome[]>()

	constructor(
		private readonly manifests: Record<string, ImageQueueItem[]> = {},
	) {}

	hold(key: string) {
		this.held.set(
			key,
			new Promise((resolve) => this.gates.set(key, () => resolve())),
		)
	}

	release(key: string) {
		this.held.delete(key)
		this.gates.get(key)?.()
	}

	script(key: string, ...outcomes: Outcome[]) {
		this.outcomes.set(key, outcomes)
	}

	count(key: string) {
		return this.calls.filter((call) => call === key).length
	}

	write(context: StepContext) {
		this.links.set(context.chapterId, context.link)
		return this.step(`write:${context.chapterId}`, context).then(
			() => undefined,
		)
	}

	review(context: StepContext) {
		return this.step(`review:${context.chapterId}`, context).then(
			() => undefined,
		)
	}

	async stage(context: StepContext) {
		await this.step(`stage:${context.chapterId}`, context)
		return this.manifests[context.chapterId] ?? []
	}

	async isDrawn(_workId: string, job: DrawJob) {
		return this.saved.has(job.assetId)
	}

	async draw(job: DrawJob, context: DrawContext) {
		this.drawing++
		this.maxDrawing = Math.max(this.maxDrawing, this.drawing)
		try {
			const result = await this.step(`draw:${job.assetId}`, context)
			const outcome = result ?? { status: 'drawn' }
			if (outcome.status === 'drawn') this.saved.add(job.assetId)
			return outcome
		} finally {
			this.drawing--
		}
	}

	private async step(
		key: string,
		context: { desensitized: boolean; signal: AbortSignal },
	): Promise<ImageJobResult | undefined> {
		this.calls.push(key)
		if (context.desensitized) this.desensitized.push(key)
		const gate = this.held.get(key)
		if (gate) {
			await new Promise<void>((resolve, reject) => {
				context.signal.addEventListener('abort', () => {
					this.aborted.push(key)
					reject(new Error('aborted'))
				})
				gate.then(resolve)
			})
		}
		const outcome = this.outcomes.get(key)?.shift()
		if (outcome instanceof Error) throw outcome
		return outcome
	}
}
