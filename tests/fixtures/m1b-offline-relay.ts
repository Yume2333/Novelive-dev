import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { bible, picture } from './cassettes/m1b-art/fixture'

export const chapters = [
	[
		'暮色压低了河面，阿妲把纸船轻轻放进水中。',
		'纸船穿过桥洞，阿妲沿着石阶追赶。',
	],
	['街灯在雨中亮起，阿妲在桥边停下。', '卖灯人递来一盏小灯，阿妲道谢。'],
	['阿妲举灯照路，看见纸船搁在芦苇旁。', '她拨开芦苇，纸船又开始随水漂流。'],
	['天色渐亮，纸船缓缓驶入开阔的河湾。', '阿妲收起小灯，沿着河岸向家走去。'],
]

export const chapterIds = chapters.map((_, i) => `ch000${i + 1}`)
export const book = chapters
	.map((lines, i) => `第${'一二三四'[i]}章 河边手记\n${lines.join('\n\n')}`)
	.join('\n')

type Operation =
	| 'preview'
	| 'synthesis'
	| 'visual'
	| 'write'
	| 'review'
	| 'stage'
	| 'painter'
	| 'image'
	| 'quality'
	| 'window-fill'

export type Admission = {
	operation: Operation
	chapter: number
	tokens: number | null
	images: number | null
	run: string
	fault?: Fault
	requestKey: string
	outputCap?: number
}

export type Fault =
	| 'malformed'
	| 'invalid-id'
	| 'over-budget'
	| 'staging-503'
	| 'writing-503'
	| 'missing-usage'
	| 'truncated'
	| 'rate-limit'
	| 'review-rate-limit'
	| 'review-raised-cap-rate-limit'
	| 'review-reasoning'
	| 'image-failure'
	| 'image-null'
	| 'image-invalid-json'
	| 'image-overdelivery'
	| 'download-failure'
	| 'download-body-failure'
	| 'soft-stop'

const endpoint = 'https://relay.invalid'

function completion(
	content: unknown,
	tokens: number | null,
	finish = 'stop',
	tool?: string,
	reasoning = false,
) {
	const text = typeof content === 'string' ? content : JSON.stringify(content)
	const delta = tool
		? {
				tool_calls: [
					{
						index: 0,
						id: 'submit',
						type: 'function',
						function: { name: tool, arguments: text },
					},
				],
			}
		: reasoning
			? { reasoning_content: text }
			: { content: text }
	const frames = [
		{
			choices: [
				{
					index: 0,
					delta: { role: 'assistant', ...delta },
					finish_reason: null,
				},
			],
		},
		{
			choices: [
				{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : finish },
			],
		},
		...(tokens === null
			? []
			: [
					{
						choices: [],
						usage: {
							prompt_tokens: tokens - 200,
							completion_tokens: 200,
							total_tokens: tokens,
						},
					},
				]),
	]
	return new Response(
		frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') +
			'data: [DONE]\n\n',
		{ headers: { 'content-type': 'text/event-stream' } },
	)
}

export function fakeRelay(faults: readonly Fault[], privateStaging = false) {
	const pending = new Set(faults)
	const admissions: Admission[] = []
	const imageBytes = new Map<string, Buffer>()
	const downloadAttempts = new Map<number, number>()
	let downloads = 0
	let currentChapter = 0
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init)
		const url = new URL(request.url)
		assert.equal(url.origin, endpoint)
		if (request.method === 'GET') {
			const bytes = imageBytes.get(url.pathname)
			assert.ok(bytes, 'Requested unknown fixture image')
			downloads++
			const index = Number(/(\d+)\.png$/.exec(url.pathname)?.[1]) - 1
			downloadAttempts.set(index, (downloadAttempts.get(index) ?? 0) + 1)
			if (currentChapter && pending.delete('download-failure')) {
				admissions[index].fault = 'download-failure'
				return new Response(null, { status: 503 })
			}
			if (
				currentChapter &&
				downloadAttempts.get(index) === 1 &&
				pending.delete('download-body-failure')
			) {
				admissions[index].fault = 'download-body-failure'
				let sent = false
				return new Response(
					new ReadableStream({
						pull(controller) {
							if (sent) controller.error(new Error('Image stream interrupted'))
							else {
								sent = true
								controller.enqueue(Uint8Array.from(bytes.subarray(0, 8)))
							}
						},
					}),
					{ headers: { 'content-type': 'image/png' } },
				)
			}
			return new Response(Uint8Array.from(bytes), {
				headers: { 'content-type': 'image/png' },
			})
		}
		assert.equal(request.method, 'POST')
		const image = /^\/v1\/images\/(generations|edits)$/.test(url.pathname)
		assert.ok(
			image || url.pathname === '/v1/chat/completions',
			'Unknown fixture route',
		)
		const body = request.headers.get('content-type')?.startsWith('multipart/')
			? Object.fromEntries(await request.formData())
			: await request.json()
		const messages: string[] = (body.messages ?? []).map(
			({ content }: { content: string | { text?: string }[] }) =>
				typeof content === 'string'
					? content
					: content.map((part) => part.text ?? '').join(''),
		)
		const prompt =
			messages.find((line) =>
				/^(Write a visual novel adaptation|You are the art director|Write only visible content|Visually audit|Preview fiction|Summarize volume)/.test(
					line,
				),
			) ?? messages.join('\n')
		const tools: string[] = (body.tools ?? []).map(
			({ function: spec }: { function: { name: string } }) => spec.name,
		)
		const operation: Operation =
			body.model === 'offline-window-fill'
				? 'window-fill'
				: image
					? 'image'
					: tools.includes('submit_quality')
						? 'quality'
						: tools.includes('submit_review')
							? 'review'
							: prompt.startsWith('Write a visual novel adaptation')
								? 'write'
								: prompt.startsWith('You are the art director')
									? 'stage'
									: prompt.startsWith('Write only visible content')
										? 'painter'
										: prompt.startsWith('Visually audit')
											? 'visual'
											: prompt.startsWith('Preview fiction')
												? 'preview'
												: 'synthesis'
		const source = prompt.split('Source paragraphs:').at(-1) ?? ''
		const paragraphs = [...source.matchAll(/^p(\d{4}): (.+)$/gm)]
		if (operation === 'write') {
			const chapter =
				chapters.findIndex((lines) =>
					lines.some((line) => paragraphs.some(([, , text]) => line === text)),
				) + 1
			assert.ok(chapter, 'Writing prompt did not cite a fixture chapter')
			currentChapter = chapter
		}
		const scenes = [...prompt.matchAll(/^(\d+): scene 河灯-(\d+)-(\d+)$/gm)]
		const repair = prompt.includes('\nRepair the ')
		const outputCap = body.max_completion_tokens ?? body.max_tokens
		const previous = admissions.at(-1)
		const fault = faults.find(
			(candidate) =>
				pending.has(candidate) &&
				((candidate === 'writing-503' &&
					operation === 'write' &&
					paragraphs.length === 1 &&
					paragraphs[0]?.[1] === '0002') ||
					(candidate === 'staging-503' &&
						operation === 'stage' &&
						scenes[0]?.[3] === '2') ||
					(candidate === 'missing-usage' && operation === 'stage') ||
					(candidate === 'truncated' && operation === 'stage') ||
					(candidate === 'rate-limit' && operation === 'write') ||
					(candidate === 'review-rate-limit' &&
						operation === 'review' &&
						prompt.includes('scene 河灯-1-2')) ||
					(candidate === 'review-raised-cap-rate-limit' &&
						operation === 'review' &&
						prompt.includes('scene 河灯-1-1') &&
						previous?.fault === 'review-reasoning' &&
						outputCap > (previous.outputCap ?? Infinity)) ||
					(candidate === 'review-reasoning' &&
						operation === 'review' &&
						prompt.includes('scene 河灯-1-1')) ||
					([
						'image-failure',
						'image-null',
						'image-invalid-json',
						'image-overdelivery',
					].includes(candidate) &&
						operation === 'image' &&
						currentChapter > 0) ||
					(candidate === 'invalid-id' && operation === 'stage' && !repair) ||
					(['malformed', 'over-budget'].includes(candidate) &&
						operation === 'stage')),
		)
		if (fault) pending.delete(fault)
		const status =
			fault === 'rate-limit' ||
			fault === 'review-rate-limit' ||
			fault === 'review-raised-cap-rate-limit'
				? 429
				: fault === 'staging-503' ||
						fault === 'writing-503' ||
						fault === 'image-failure'
					? 503
					: 200
		const tokens =
			status !== 200 ||
			fault === 'missing-usage' ||
			fault === 'image-null' ||
			fault === 'image-invalid-json'
				? null
				: operation === 'window-fill'
					? Number(body.max_tokens)
					: image
						? fault === 'image-overdelivery'
							? 30_509
							: 700
						: 2_000
		const images =
			tokens === null
				? null
				: fault === 'image-overdelivery'
					? 3
					: Number(image)
		if (fault === 'image-overdelivery') assert.equal(Number(body.n), 1)
		const run = process.env.NL_RUN_ID ?? ''
		const attributedChapter = /(?:scene 河灯-|fixture-(?:bank|cg)-)(\d+)/.exec(
			String(image ? body.prompt : prompt),
		)?.[1]
		admissions.push({
			operation,
			chapter: attributedChapter ? Number(attributedChapter) : currentChapter,
			tokens,
			images,
			run,
			fault,
			outputCap,
			requestKey: createHash('sha256')
				.update(
					JSON.stringify(
						image ? [body.prompt, body.size] : [messages, outputCap],
					),
				)
				.digest('hex'),
		})
		const csv = process.env.NL_USAGE_CSV
		assert.ok(csv, 'Offline admission needs a run-specific CSV')
		await appendFile(
			csv,
			`${run},${operation},1,${tokens ?? ''},${images ?? ''},${fault ?? ''}\n`,
		)
		if (status !== 200)
			return Response.json({ error: { message: 'Offline fault' } }, { status })
		if (fault === 'image-null') return Response.json(null)
		if (fault === 'image-invalid-json')
			return new Response('{', {
				headers: { 'content-type': 'application/json' },
			})
		if (image) {
			const path = `/v1/download/${admissions.length}.png`
			const [width, height] = String(body.size).split('x').map(Number)
			imageBytes.set(
				path,
				await picture(width, height, body.background === 'transparent'),
			)
			return Response.json({
				data: Array.from({ length: images ?? 0 }, (_, i) => ({
					url: i ? `${endpoint}${path}?variant=${i}` : endpoint + path,
				})),
				usage: { total_tokens: tokens },
			})
		}
		const reply = (content: unknown, finish = 'stop', tool?: string) =>
			completion(content, tokens, finish, tool)
		if (operation === 'window-fill')
			return Response.json({ usage: { total_tokens: tokens } })
		if (operation === 'quality')
			return reply(
				{
					score: { fidelity: 4, consistency: 4, foreshadowing: 3, staging: 4 },
					reasons: ['The cited source event is retained.'],
					failedChecks: [],
				},
				'stop',
				'submit_quality',
			)
		if (operation === 'review')
			return fault === 'review-reasoning'
				? completion(
						'Considering the cited source.',
						tokens,
						'length',
						undefined,
						true,
					)
				: reply({ issues: [] }, 'stop', 'submit_review')
		if (operation === 'visual')
			return reply({ pass: true, failedChecks: [], feedback: '' })
		if (operation === 'painter')
			return reply({
				content: `A lantern on a quiet stone bridge at dusk. ${/fixture-(?:bank|cg)-[\d-]+/.exec(prompt)?.[0] ?? ''}`,
			})
		if (operation === 'preview')
			return reply({
				summary: 'A paper boat drifts beneath a bridge.',
				characters: [],
				locations: [],
				timelineNotes: [],
				foreshadowingHints: [],
			})
		if (operation === 'synthesis') {
			if (prompt.startsWith('Summarize volume'))
				return reply({ summary: 'The paper boat follows the river.' })
			assert.ok(
				prompt.includes('Chapter previews:'),
				'Unexpected synthesis request',
			)
			return reply({
				overview: 'A small river journey lit by lanterns.',
				chapters: chapterIds.map((chapterId) => ({
					chapterId,
					progress: 'The boat drifts farther.',
				})),
				biblePatch: [
					{ op: 'add', kind: 'style', entry: bible.style },
					{
						op: 'add',
						kind: 'character',
						entry: {
							...bible.characters[0],
							name: '阿妲',
							status: 'candidate',
							firstSeenChapter: 'ch0001',
						},
					},
					{
						op: 'add',
						kind: 'location',
						entry: { ...bible.locations[0], status: 'candidate' },
					},
				],
				glossaryPatch: [],
			})
		}
		if (
			operation === 'write' &&
			pending.has('writing-503') &&
			paragraphs.length > 1
		)
			return reply('scene', 'length')
		if (operation === 'write')
			return reply(
				paragraphs
					.map(
						([, id, text]) =>
							`scene 河灯-${currentChapter}-${Number(id)}\nsource p${id}\n\n: ${text}`,
					)
					.join('\n\n'),
			)
		if (fault === 'malformed' || fault === 'truncated')
			return reply('{', fault === 'truncated' ? 'length' : 'stop')
		if (privateStaging) return reply({ patch: '', items: [], merges: {} })
		const surplus =
			fault === 'over-budget' ||
			(repair && prompt.includes('new provider images; budget is'))
		const cgs = surplus
			? Array.from(
					{ length: 13 },
					(_, i) => `cg-lantern-${scenes[0]?.[2]}-${scenes[0]?.[3]}-${i}`,
				)
			: []
		assert.ok(
			scenes.length,
			'Stage prompt did not contain a numbered fixture scene',
		)
		const placements = scenes.map(([, line, chapter, scene]) => ({
			line: Number(line) + 3,
			bg: fault === 'invalid-id' ? 'room' : `bank-${chapter}-${scene}/day`,
		}))
		return reply({
			patch: placements
				.flatMap(({ line, bg }, i) => [
					`PUT <${line}:`,
					`@bg ${bg}`,
					'@show ada/uniform/neutral center',
					...(i === 0 ? cgs.map((id) => `@cg ${id}`) : []),
				])
				.join('\n'),
			items: [
				...placements.map(({ bg }) => ({
					id: bg,
					kind: 'location',
					description: `Stone steps above a lantern-lit river (${bg.replace('bank-', 'fixture-bank-')}).`,
				})),
				...cgs.map((id) => ({
					id,
					kind: 'cg',
					description: `A lantern reflected in water (${id.replace('cg-lantern-', 'fixture-cg-')}).`,
				})),
			],
			merges: {},
		})
	}
	return {
		fetch,
		admissions,
		pending,
		downloadAttempts,
		get downloads() {
			return downloads
		},
	}
}
