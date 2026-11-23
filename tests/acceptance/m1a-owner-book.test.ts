import { createHash } from 'node:crypto'
import {
	access,
	appendFile,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { headingRules } from '../../packages/creator/src/import/txt'
import {
	buildTextModel,
	outputTokenBudget,
	type TextConnection,
	TextModelError,
} from '../../packages/creator/src/models/text'
import { Project } from '../../packages/creator/src/project'
import {
	importTxt,
	prepareVolume,
} from '../../packages/creator/src/project-pipeline'
import { createReplayFetch } from '../../packages/creator/src/replay'
import {
	synthesisFiles,
	synthesizeVolume,
	type VolumeSynthesis,
} from '../../packages/creator/src/synthesis'
import { readBible } from '../../packages/creator/src/synthesis/patch'
import { projectFiles } from '../../packages/format/src/model'
import { scoreBiblePatches } from './bible-patch-score'
import { observeOwnerBookUsage } from './owner-book-usage'

const home = homedir()
const source = join(home, 'novelive-testbooks', 'yesou-puyan.txt')
const root = join(home, '.local/novelive-tools/m1a-owner-book')
const ledger = join(home, 'memory/poke_5b9601/files/novelive/usage.csv')
const purpose = 'M1a/07 owner book with shared inclusion criteria'
const previewModel = 'gemini-3.8-flash'
const cap = 5_000_000
const eventContextWindow = 16_384
const wholeContextWindow = 256_000
const series = {
	formatVersion: 1,
	seriesId: 'yesou-puyan',
	title: '野叟曝言',
	volumeIds: [],
} as const
const confirmed = projectFiles.character({ level: 'series' }, 'wen-suchen')
const entry = {
	id: 'wen-suchen',
	name: '文素臣',
	aliases: ['文白'],
	status: 'confirmed' as const,
}
const language = 'zh-TW'
const bookHeadingRules = headingRules.map((rule) =>
	rule.name === 'numbered'
		? { ...rule, pattern: /^第[一二三四五六七八九十百零〇]+回\s+\S/ }
		: rule,
)
const digest = (body: Uint8Array) =>
	createHash('sha256').update(body).digest('hex')

// Allow for the relay's startup and for output at one-third of the observed rate.
const requestTimeout = (outputTokens: number) =>
	90_000 + Math.ceil(outputTokens / 40) * 1000
// Budget for the eight observed events and whole control, each with a repair.
const volumeTimeout =
	requestTimeout(0) +
	2 *
		(8 * requestTimeout(eventContextWindow / 2) +
			requestTimeout(wholeContextWindow / 2))

function requestFailure(signal: AbortSignal, error: unknown) {
	if (signal.aborted)
		return signal.reason?.name === 'TimeoutError' ? 'deadline' : 'aborted'
	if (error instanceof SyntaxError) return 'invalid usage payload'
	return 'transport or response read failed'
}

test.skipIf(process.env.NL_REPLAY !== 'record')(
	'M1a/07 imports a complete public-domain book and compares one real volume on disk',
	async () => {
		const synthesisModel =
			process.env.NL_OWNER_BOOK_SYNTHESIS_MODEL ?? 'devin-swe-2'
		if (
			synthesisModel !== 'devin-swe-2' &&
			synthesisModel !== 'gemini-3.8-flash'
		)
			throw new Error('Unexpected synthesis model')
		const mustResume = process.env.NL_OWNER_BOOK_EXPECT_RESUME === '1'
		let expectedResume: { packet: number; events: number } | undefined
		const baseUrl = process.env.NL_IMAGE_BASE_URL
		const apiKey = process.env.NL_IMAGE_API_KEY
		if (!baseUrl || !apiKey)
			throw new Error('The provisioned relay environment is unavailable')
		const endpoint = new URL(baseUrl)
		if (endpoint.pathname === '/') endpoint.pathname = '/v1'
		const controller = new AbortController()
		const connection = {
			baseUrl: endpoint.href,
			apiKey,
			compat: 'auto',
			format: 'openai-completions',
		} as const
		const previewConnection = {
			...connection,
			model: previewModel,
			contextWindow: 1_000_000,
		} satisfies TextConnection
		const synthesisConnection = {
			...connection,
			model: synthesisModel,
			contextWindow: wholeContextWindow,
		} satisfies TextConnection
		const eventConnection = {
			...synthesisConnection,
			contextWindow: eventContextWindow,
		}
		const timeoutFor = (slot: TextConnection) =>
			requestTimeout(outputTokenBudget(buildTextModel(slot)))
		const stats = {
			calls: 0,
			tokens: 0,
			images: 0,
			reserved: 0,
			previewCalls: 0,
			synthesisCalls: 0,
			packetCount: 0,
			resumedPacket: 0,
			resumedEvents: 0,
		}
		let used = 0
		const pendingUsage = new Set<Promise<void>>()
		let ledgerFailed = false
		for (const line of (await readFile(ledger, 'utf8')).split('\n')) {
			const [, , , tokens, , reason] = line.split(',')
			if (reason?.startsWith(purpose)) used += Number(tokens)
		}
		const paid: typeof globalThis.fetch = async (input, init) => {
			controller.signal.throwIfAborted()
			const request = new Request(input, init)
			if (
				request.method !== 'POST' ||
				!new URL(request.url).pathname.endsWith('/chat/completions')
			)
				throw new Error('Real-book run only permits text completions')
			const text = await request.clone().text()
			const payload = JSON.parse(text)
			const model: string = payload.model
			if (model !== previewModel && model !== synthesisModel)
				throw new Error('Unexpected real-book provider model')
			const outputCap = payload.max_completion_tokens ?? payload.max_tokens
			if (!Number.isSafeInteger(outputCap) || outputCap < 1)
				throw new Error('Real-book request has no valid output cap')
			const reserve = Buffer.byteLength(text) + outputCap + 1024
			if (used + reserve > cap) {
				controller.abort()
				throw new Error('Real-book token cap reached')
			}
			const prompt = payload.messages[0]?.content
			const isSynthesis =
				typeof prompt === 'string' &&
				prompt.startsWith('Synthesize the ordered chapter previews')
			if (mustResume && !isSynthesis) {
				controller.abort()
				throw new Error('Resume attempted a paid preview request')
			}
			used += reserve
			const call = ++stats.calls
			stats.previewCalls += Number(!isSynthesis)
			stats.synthesisCalls += Number(isSynthesis)
			const match = /Extract only the next event in packet \d+\/(\d+)/.exec(
				text,
			)
			stats.packetCount = Math.max(stats.packetCount, Number(match?.[1] ?? 0))
			const deadline = AbortSignal.timeout(requestTimeout(outputCap))
			const signal = AbortSignal.any([request.signal, deadline])
			const started = Date.now()
			const failed = (phase: string, error: unknown) => {
				const reason = deadline.aborted
					? 'deadline'
					: requestFailure(signal, error)
				console.log(
					`M1a/07 request ${call} ${phase}: ${reason} (${Date.now() - started}ms)`,
				)
			}
			const settle = async (measured?: number) => {
				const tokens = measured ?? reserve
				used += tokens - reserve
				stats.tokens += tokens
				stats.reserved += Number(measured === undefined)
				try {
					await appendFile(
						ledger,
						`${new Date().toISOString().slice(0, 10)},${model},1,${tokens},0,${purpose}${measured === undefined ? ' (reserved upper bound)' : ''}\n`,
					)
				} catch {
					ledgerFailed = true
					controller.abort()
				}
			}
			try {
				const response = await fetch(request, { signal })
				if (!response.ok) {
					console.log(`${model} HTTP ${response.status}`)
					if ([401, 403, 404, 429, 503].includes(response.status))
						controller.abort()
				}
				const usage = observeOwnerBookUsage(response, settle, (error) =>
					failed('body', error),
				)
				pendingUsage.add(usage)
				void usage.then(() => pendingUsage.delete(usage))
				return response
			} catch (error) {
				failed('headers', error)
				await settle()
				throw new Error(`${model} request did not complete`)
			}
		}
		await mkdir(root, { recursive: true, mode: 0o700 })
		const book = await readFile(source)
		const sha256 = digest(book)
		const manifest = JSON.parse(
			await readFile(
				join(home, 'novelive-testbooks', 'yesou-puyan.json'),
				'utf8',
			),
		)
		expect(sha256).toBe(manifest.sha256)
		const run =
			process.env.NL_OWNER_BOOK_RUN_DIR ?? (await mkdtemp(join(root, 'run-')))
		const directory = join(run, 'events')
		const cassette = {
			directory: join(root, 'cassette'),
			case: 'm1a-owner-book',
		}
		const upstream = createReplayFetch({
			...cassette,
			mode: 'record',
			fetch: paid,
		})
		const replay = createReplayFetch({
			...cassette,
			mode: 'replay',
			ignoreRecordedFailures: true,
			fetch: upstream,
		})
		const fetchReplay: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init)
			if (expectedResume) {
				const prompt = (await request.clone().json()).messages[0]?.content
				const packet = /Extract only the next event in packet (\d+)\/\d+/.exec(
					prompt,
				)
				const events = /^Events already extracted: (\d+)$/m.exec(prompt)
				if (
					Number(packet?.[1]) !== expectedResume.packet ||
					Number(events?.[1]) !== expectedResume.events
				)
					throw new Error('Request did not resume the saved synthesis packet')
				stats.resumedPacket = expectedResume.packet
				stats.resumedEvents = expectedResume.events
				expectedResume = undefined
			}
			return replay(request)
		}
		const options = {
			previewConnection,
			synthesisConnection: eventConnection,
			requestTimeoutMs: timeoutFor(eventConnection),
			language,
			strategy: 'events' as const,
			fetch: fetchReplay,
			signal: controller.signal,
		}
		async function provision(path: string) {
			const exists = await access(join(path, projectFiles.database)).then(
				() => true,
				(error) => {
					if (error.code !== 'ENOENT') throw error
					return false
				},
			)
			if (exists) {
				const project = await Project.open(path)
				try {
					expect(
						digest(await project.readFile(projectFiles.original('txt'))),
					).toBe(sha256)
					return project
				} catch (error) {
					project.close()
					throw error
				}
			}
			const project = await Project.create(path, { ...series, volumeIds: [] })
			try {
				const imported = await importTxt(project, book, {
					title: series.title,
					language,
					encoding: 'utf-8',
					rules: bookHeadingRules,
				})
				await project.write(confirmed, { formatVersion: 1, entries: [entry] })
				expect(imported.structure.volumes).toHaveLength(20)
				expect(
					imported.structure.volumes.flatMap((volume) => volume.chapters),
				).toHaveLength(154)
				return project
			} catch (error) {
				project.close()
				throw error
			}
		}
		let phase = 'import'
		try {
			const first = await provision(directory)
			let closed = false
			let chunked: VolumeSynthesis
			let volumeId: string
			let chapterIds: string[]
			let previewBytes: number
			try {
				const volumes = (await first.read(projectFiles.series)).volumeIds
				volumeId = volumes[0]
				const volume = await first.read(projectFiles.volume(volumeId))
				chapterIds = (
					await first.read(projectFiles.work(volumeId, volume.workIds[0]))
				).chapterIds
				expect(chapterIds).toHaveLength(7)
				if (mustResume) {
					const saved = await first.read(synthesisFiles(volumeId).checkpoint)
					expect(saved.applied).toBe(false)
					expect(saved.events.length).toBeGreaterThan(0)
					expectedResume = {
						packet: saved.packet + 1,
						events: saved.events.length,
					}
				}
				phase = 'preview and chunked synthesis'
				const existingCharacters = (await readBible(first)).character
				const result = await prepareVolume(first, volumeId, options)
				chunked = result.synthesis
				previewBytes = result.previews.reduce(
					(sum, preview) => sum + Buffer.byteLength(JSON.stringify(preview)),
					0,
				)
				const checkpoint = await first.read(synthesisFiles(volumeId).checkpoint)
				expect(checkpoint.packet).toBeGreaterThan(1)
				expect(checkpoint.applied).toBe(true)
				phase = 'whole-volume control'
				using whole = await provision(join(run, 'whole'))
				for (const id of chapterIds)
					await whole.write(
						projectFiles.preview(id),
						await first.read(projectFiles.preview(id)),
					)
				const reference = await synthesizeVolume(whole, volumeId, chapterIds, {
					connection: synthesisConnection,
					requestTimeoutMs: timeoutFor(synthesisConnection),
					language,
					strategy: 'whole',
					fetch: fetchReplay,
					signal: controller.signal,
				})
				const score = scoreBiblePatches(reference, chunked, existingCharacters)
				const expected = { formatVersion: 1, entries: [entry] }
				const confirmedIntact =
					JSON.stringify(await whole.read(confirmed)) ===
						JSON.stringify(expected) &&
					JSON.stringify(await first.read(confirmed)) ===
						JSON.stringify(expected)
				phase = 'restart'
				first.close()
				closed = true
				using reopened = await Project.open(directory)
				let restartRequests = 0
				const fetched = await prepareVolume(reopened, volumeId, {
					...options,
					fetch: async () => {
						restartRequests++
						throw new Error('Reopening attempted a provider request')
					},
				})
				const restartIntact =
					restartRequests === 0 &&
					digest(await reopened.readFile(projectFiles.original('txt'))) ===
						sha256 &&
					JSON.stringify(fetched.synthesis) === JSON.stringify(chunked) &&
					JSON.stringify(await reopened.read(confirmed)) ===
						JSON.stringify(expected)
				await Promise.all(pendingUsage)
				if (ledgerFailed)
					throw new Error('Could not write the private usage ledger')
				const report = {
					sha256,
					chapters: 154,
					volumes: 20,
					comparedChapters: chapterIds.length,
					previewBytes,
					packets: checkpoint.packet,
					events: checkpoint.events.length,
					...score,
					confirmedIntact,
					restartRequests,
					restartIntact,
					stats,
				}
				await writeFile(
					join(root, 'redacted-result.json'),
					JSON.stringify(report, null, 2),
				)
				console.log(JSON.stringify(report))
				expect(confirmedIntact && restartIntact).toBe(true)
				phase = 'normalized BiblePatch F1'
				expect(score.f1).toBeGreaterThanOrEqual(0.9)
			} finally {
				if (!closed) first.close()
			}
		} catch (error) {
			const code = error instanceof TextModelError ? ` [${error.code}]` : ''
			throw new Error(
				`M1a/07 did not pass during ${phase}${code}; see the redacted result and usage`,
			)
		} finally {
			controller.abort()
			await Promise.all(pendingUsage)
			console.log(`M1a/07 usage: ${JSON.stringify(stats)}`)
		}
	},
	volumeTimeout,
)
