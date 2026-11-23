import { createHash } from 'node:crypto'
import {
	access,
	appendFile,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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
	type VolumeSynthesis,
} from '../../packages/creator/src/synthesis'
import { projectFiles } from '../../packages/format/src/model'
import { scoreAgainstConsensus } from './bible-patch-score'
import { checkOwnerBookResumePrompt } from './owner-book-resume'
import {
	type WholeBookRun,
	wholeBookSelectionTargets,
} from './owner-book-targets'
import {
	observeOwnerBookUsage,
	ownerBookSelectionBatchCap,
	ownerBookSelectionCap,
	reserveOwnerBookSelection,
} from './owner-book-usage'

const home = homedir()
const source = join(home, 'novelive-testbooks', 'yesou-puyan.txt')
const root = join(home, '.local/novelive-tools/m1a-owner-book')
const ledger = join(home, 'memory/poke_5b9601/files/novelive/usage.csv')
const fullPurpose = 'M1a/07 owner book with shared inclusion criteria'
const selectionPurpose = 'M1a/07 W4 selection-only 700k'
const batchPurpose = 'M1a/07 W4 aligned selection batch 300k'
const savedEvents = 81
const savedPackets = 7
const previewModel = 'gemini-3.8-flash'
const cap = 5_000_000
const eventContextWindow = 16_384
const wholeContextWindow = 256_000
const repo = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtures = join(repo, 'tests/fixtures/m1a-owner-book')
const evidence = join(repo, '.workflow/evidence/m1a/owner')
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
const initialCharacters = { formatVersion: 1 as const, entries: [entry] }
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
// Budget for up to twenty-four events, each with a repair.
const volumeTimeout =
	requestTimeout(0) + 2 * 24 * requestTimeout(eventContextWindow / 2)

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
		const checkpointSource = process.env.NL_OWNER_BOOK_SELECTION_SOURCE
		const runDirectory = process.env.NL_OWNER_BOOK_RUN_DIR
		const dryRun = process.env.NL_OWNER_BOOK_SELECTION_STUB
		const batch = process.env.NL_OWNER_BOOK_SELECTION_BATCH === '1'
		const selectionCap = batch
			? ownerBookSelectionBatchCap
			: ownerBookSelectionCap
		const purpose = batch
			? batchPurpose
			: checkpointSource
				? selectionPurpose
				: fullPurpose
		if (
			(batch && !checkpointSource) ||
			(dryRun &&
				(!checkpointSource || !['complete', 'cap'].includes(dryRun))) ||
			(checkpointSource &&
				(!runDirectory ||
					resolve(checkpointSource) === resolve(runDirectory, 'events') ||
					synthesisModel !== 'devin-swe-2' ||
					mustResume))
		)
			throw new Error(
				'Selection-only requires a separate run directory and the saved main model',
			)
		const recorded: { volumeId: string; runs: WholeBookRun[] } = JSON.parse(
			await readFile(join(fixtures, 'whole-runs.json'), 'utf8'),
		)
		const selectionTargets = wholeBookSelectionTargets(recorded.runs)
		const stubLedger =
			dryRun && batch && runDirectory
				? join(dirname(runDirectory), 'stub-usage.csv')
				: undefined
		const usageLedger = stubLedger ?? ledger
		let expectedResume: { packet: number; events: number } | undefined
		const baseUrl = dryRun
			? 'https://relay.invalid'
			: process.env.NL_IMAGE_BASE_URL
		const apiKey = dryRun ? 'offline-stub' : process.env.NL_IMAGE_API_KEY
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
		const selectionConnection = {
			...synthesisConnection,
			maxOutputTokens: 32_768,
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
			selectionPrompts: [] as {
				candidates: number
				bytes: number
				outputCap: number
				estimatedInput: number
				estimate: number
				reserved: number
			}[],
		}
		let used = 0
		let capReached = false
		const pendingUsage = new Set<Promise<void>>()
		let ledgerFailed = false
		let reservationExceeded = false
		const priorUsage =
			dryRun && !stubLedger
				? ''
				: await readFile(usageLedger, 'utf8').catch((error) => {
						if (stubLedger && error.code === 'ENOENT') return ''
						throw error
					})
		for (const line of priorUsage.split('\n')) {
			const [, , , tokens, , reason] = line.split(',')
			if (reason?.startsWith(purpose)) used += Number(tokens)
		}
		const paid: typeof globalThis.fetch = async (input, init) => {
			if (checkpointSource) await Promise.all(pendingUsage)
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
			if (
				model !== synthesisModel &&
				(checkpointSource || model !== previewModel)
			)
				throw new Error('Unexpected real-book provider model')
			const outputCap = payload.max_completion_tokens ?? payload.max_tokens
			if (!Number.isSafeInteger(outputCap) || outputCap < 1)
				throw new Error('Real-book request has no valid output cap')
			const prompt = payload.messages[0]?.content
			const isSynthesis =
				typeof prompt === 'string' &&
				prompt.startsWith('Synthesize the ordered chapter previews')
			if (mustResume && !isSynthesis) {
				controller.abort()
				throw new Error('Resume attempted a paid preview request')
			}
			if (
				checkpointSource &&
				['tools', 'functions', 'response_format', 'prediction', 'n'].some(
					(key) => Object.hasOwn(payload, key),
				)
			)
				throw new Error('Unexpected prompt data outside selection messages')
			if (dryRun === 'cap') used = selectionCap
			const selectionReserve = checkpointSource
				? reserveOwnerBookSelection(
						used,
						payload.messages,
						outputCap,
						selectionCap,
					)
				: undefined
			const reserve = checkpointSource
				? selectionReserve?.reserved
				: Buffer.byteLength(text) + outputCap + 1024
			if (
				reserve === undefined ||
				(!checkpointSource && used + reserve > cap)
			) {
				capReached = true
				controller.abort()
				throw new Error('Real-book token cap reached')
			}
			used += reserve
			const call = ++stats.calls
			if (selectionReserve) {
				const lines = prompt.split('\nCandidates:\n')[1].split('\n')
				stats.selectionPrompts.push({
					candidates: lines.length,
					bytes: Buffer.byteLength(prompt),
					outputCap,
					...selectionReserve,
				})
			}
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
				if (dryRun && !stubLedger) return
				try {
					await appendFile(
						usageLedger,
						`${new Date().toISOString().slice(0, 10)},${model},1,${tokens},0,${purpose}${measured === undefined ? ' (reserved upper bound)' : ''}\n`,
					)
				} catch {
					ledgerFailed = true
					controller.abort()
				}
				if (checkpointSource && tokens > reserve) {
					reservationExceeded = true
					controller.abort()
				}
			}
			try {
				const response = dryRun
					? new Response(
							`data: ${JSON.stringify({
								id: 'selection-stub',
								object: 'chat.completion.chunk',
								model,
								choices: [
									{
										index: 0,
										delta: { content: '{"keep":[]}' },
										finish_reason: 'stop',
									},
								],
								usage: {
									prompt_tokens: batch ? 69_999 : 1,
									completion_tokens: 1,
									total_tokens: batch ? 70_000 : 2,
								},
							})}\n\ndata: [DONE]\n\n`,
							{ headers: { 'content-type': 'text/event-stream' } },
						)
					: await fetch(request, { signal })
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
		const run = runDirectory ?? (await mkdtemp(join(root, 'run-')))
		if (checkpointSource) await mkdir(run, { recursive: true, mode: 0o700 })
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
			if (checkpointSource) {
				checkOwnerBookResumePrompt(
					(await request.clone().json()).messages[0]?.content,
				)
				return dryRun ? paid(request) : upstream(request)
			}
			if (expectedResume) {
				const prompt = (await request.clone().json()).messages[0]?.content
				if (
					checkOwnerBookResumePrompt(prompt, expectedResume) === 'extraction'
				) {
					stats.resumedPacket = expectedResume.packet
					stats.resumedEvents = expectedResume.events
				}
				expectedResume = undefined
			}
			return replay(request)
		}
		const options = {
			previewConnection,
			synthesisConnection: eventConnection,
			selectionConnection,
			selectionTargets,
			requestTimeoutMs: timeoutFor(selectionConnection),
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
			if (checkpointSource) {
				using archived = await Project.open(checkpointSource)
				expect(
					digest(await archived.readFile(projectFiles.original('txt'))),
				).toBe(sha256)
				const { volumeIds } = await archived.read(projectFiles.series)
				expect(volumeIds).toHaveLength(20)
				const files = synthesisFiles(volumeIds[0])
				const saved = await archived.read(files.checkpoint)
				expect(saved).toMatchObject({
					ready: true,
					applied: true,
					packet: savedPackets,
					whole: null,
				})
				expect(saved.events).toHaveLength(savedEvents)
				const exclusions = [
					'bible',
					projectFiles.glossary({ level: 'series' }).path,
					files.result.path,
					files.checkpoint.path,
				].map((name) => resolve(checkpointSource, name))
				await cp(checkpointSource, path, {
					recursive: true,
					filter: (name) => !exclusions.includes(resolve(name)),
				})
				const project = await Project.open(path)
				try {
					await project.write(confirmed, initialCharacters)
					const { selectedPatch: _frozen, ...extraction } = saved
					await project.write(files.checkpoint, {
						...extraction,
						applied: false,
						selections: [],
					})
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
				await project.write(confirmed, initialCharacters)
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
				const files = synthesisFiles(volumeId)
				const selectionStart = checkpointSource
					? await first.read(files.checkpoint)
					: undefined
				if (selectionStart) {
					expect(selectionStart.packet).toBe(savedPackets)
					expect(selectionStart.events).toHaveLength(savedEvents)
					expect(selectionStart.whole).toBe(null)
					if (!selectionStart.applied) {
						expect(selectionStart.ready).toBe(true)
						expect(selectionStart.selections).toBeDefined()
						expect(selectionStart.selectedPatch).toBeUndefined()
					}
					stats.resumedPacket = selectionStart.packet
					stats.resumedEvents = selectionStart.events.length
				}
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
				const result = await prepareVolume(first, volumeId, options).catch(
					async (error) => {
						if (!capReached || !selectionStart) throw error
						const paused = await first.read(files.checkpoint)
						expect(paused).toMatchObject({
							events: selectionStart.events,
							packet: selectionStart.packet,
							basis: selectionStart.basis,
							applied: false,
						})
						expect(paused.selections?.length).toBeGreaterThanOrEqual(
							selectionStart.selections?.length ?? 0,
						)
						if (dryRun === 'cap') expect(paused.selections).toEqual([])
						await Promise.all(pendingUsage)
						if (ledgerFailed)
							throw new Error('Could not write the private usage ledger')
						const report = {
							status: 'paused at token cap',
							used,
							cap: selectionCap,
							selections: paused.selections?.length,
							stats,
						}
						await writeFile(
							join(run, 'selection-result.json'),
							JSON.stringify(report, null, 2),
						)
						console.log(JSON.stringify(report))
					},
				)
				if (!result) return
				chunked = result.synthesis
				previewBytes = result.previews.reduce(
					(sum, preview) => sum + Buffer.byteLength(JSON.stringify(preview)),
					0,
				)
				const checkpoint = await first.read(files.checkpoint)
				if (selectionStart) {
					expect(checkpoint.events).toEqual(selectionStart.events)
					expect(checkpoint.packet).toBe(selectionStart.packet)
					expect(stats.previewCalls).toBe(0)
				}
				expect(checkpoint.packet).toBeGreaterThan(1)
				expect(checkpoint.applied).toBe(true)
				phase = 'consensus comparison'
				expect(recorded.volumeId).toBe(volumeId)
				const score = scoreAgainstConsensus(
					recorded.runs,
					chunked,
					initialCharacters.entries,
				)
				const expected = initialCharacters
				const confirmedIntact =
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
				if (reservationExceeded) controller.signal.throwIfAborted()
				const report = {
					status: score.normalized >= 0.9 ? 'passed' : 'below W4 threshold',
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
				const fixture = `${JSON.stringify(
					{
						formatVersion: 1,
						volumeId,
						model: synthesisModel,
						biblePatch: chunked.biblePatch,
						glossaryPatch: chunked.glossaryPatch,
					},
					null,
					'\t',
				)}\n`
				if (checkpointSource) {
					await writeFile(
						join(run, 'selection-result.json'),
						JSON.stringify(report, null, 2),
					)
					await writeFile(join(run, 'chunked-run.json'), fixture)
					expect(confirmedIntact && restartIntact).toBe(true)
					if (dryRun) {
						console.log(JSON.stringify(report))
						return
					}
					phase = 'consensus-normalized BiblePatch F1'
					if (score.normalized < 0.9) console.log(JSON.stringify(report))
					expect(score.normalized).toBeGreaterThanOrEqual(0.9)
				} else {
					await writeFile(
						join(root, 'redacted-result.json'),
						JSON.stringify(report, null, 2),
					)
				}
				await writeFile(join(fixtures, 'chunked-run.json'), fixture)
				await writeFile(
					join(evidence, 'w4-consensus.json'),
					`${JSON.stringify(report, null, '\t')}\n`,
				)
				console.log(JSON.stringify(report))
				expect(confirmedIntact && restartIntact).toBe(true)
				phase = 'consensus-normalized BiblePatch F1'
				expect(score.normalized).toBeGreaterThanOrEqual(0.9)
			} finally {
				if (!closed) first.close()
			}
		} catch (error) {
			if (reservationExceeded)
				throw new Error(
					'Selection usage exceeded the request reservation; check the private ledger',
				)
			const code = error instanceof TextModelError ? ` [${error.code}]` : ''
			throw new Error(
				`M1a/07 did not pass during ${phase}${code}; see the redacted result and usage`,
				dryRun ? { cause: error } : undefined,
			)
		} finally {
			controller.abort()
			await Promise.all(pendingUsage)
			console.log(`M1a/07 usage: ${JSON.stringify(stats)}`)
		}
	},
	volumeTimeout,
)
