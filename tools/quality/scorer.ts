import { arr, compile, int, obj, str } from '@earendil-works/pi-schema'
import { compileScript } from '@novelive/format/script'
import type { TextConnection } from '../../packages/creator/src/models/text'
import { writingModel } from '../../packages/creator/src/pipeline/writing/request'

const rubric = {
	fidelity:
		'Keep every event and its speaker in the correct cited paragraph, even when adjacent paragraphs share characters or actions.',
	consistency:
		'Respect names, aliases, costumes, and who knows each fact at this point.',
	foreshadowing:
		'Keep clues implicit without omitting them or revealing their later payoff.',
	staging:
		'Keep actions depictable in a visual novel; do not make the player infer simultaneous staged events.',
} as const
type Dimension = keyof typeof rubric
export type Failure = Dimension | 'metrics'
const grade = int({ minimum: 0, maximum: 4 })
const submissionSchema = obj({
	score: obj({
		fidelity: grade,
		consistency: grade,
		foreshadowing: grade,
		staging: grade,
	}),
	reasons: arr(str()),
	failedChecks: arr(str({ pattern: `^(${Object.keys(rubric).join('|')})$` })),
})
const submission = compile(submissionSchema)

export type QualityCase = {
	id: string
	producer: string
	source: readonly { id: string; text: string }[]
	speakers: readonly string[]
	bible: string
	script: string
	maxLineChars: number
}
type Report = {
	id: string
	mechanics: ReturnType<typeof measure>
} & (
	| { verdict: 'undecided'; error: string }
	| {
			verdict: 'pass' | 'fail'
			score: Record<Failure, number>
			reasons: string[]
			failedChecks: Failure[]
	  }
)

function measure(test: QualityCase) {
	const script = compileScript(test.script, {
		paragraphIds: test.source.map(({ id }) => id),
		speakers: test.speakers,
		assets: [],
	})
	const lineLengths = script.ok
		? script.scenes.flatMap(({ beats }) =>
				beats.flatMap(({ line }) =>
					line?.type === 'text'
						? [
								line.content.reduce(
									(length, part) =>
										length + (part.type === 'text' ? [...part.text].length : 0),
									0,
								),
							]
						: [],
				),
			)
		: []
	return {
		compiled: script.ok,
		diagnostics: script.diagnostics.map(({ code }) => code),
		paragraphs: test.source.length,
		textLines: lineLengths.length,
		longestLine: Math.max(0, ...lineLengths),
		overlongLines: lineLengths.filter((length) => length > test.maxLineChars)
			.length,
	}
}

export async function evaluate(
	cases: readonly QualityCase[],
	judge: TextConnection,
	fetch: typeof globalThis.fetch,
) {
	const model = writingModel(judge, { fetch })
	const trials: Report[] = []
	for (const test of cases) {
		if (test.producer === judge.model)
			throw new Error('The quality judge must differ from the script producer')
		const mechanics = measure(test)
		try {
			const result = await model.request(
				{
					systemPrompt:
						'Independently judge this visual-novel adaptation using the checklist. Score each dimension 0–4 (4 excellent, 3 adequate, 0–2 a material failure). List every dimension with a material failure in failedChecks. Identify the relevant source paragraph and draft evidence in reasons. Submit via submit_quality; do not rewrite the draft.',
					messages: [
						{
							role: 'user',
							timestamp: 0,
							content: JSON.stringify({
								checklist: rubric,
								source: test.source,
								bible: test.bible,
								draft: test.script,
							}),
						},
					],
					tools: [
						{
							name: 'submit_quality',
							description:
								'Submit the dimension scores, reasons, and failed checklist IDs.',
							parameters: submissionSchema,
						},
					],
				},
				'Quality judge',
			)
			const calls = result.content.filter((part) => part.type === 'toolCall')
			const checked = submission.validate(calls[0]?.arguments)
			if (
				calls.length !== 1 ||
				calls[0].name !== 'submit_quality' ||
				!checked.ok
			)
				throw new Error('Invalid quality submission')
			const { score, reasons, failedChecks } = checked.value
			const dimensions = Object.keys(rubric) as Dimension[]
			if (dimensions.some((id) => failedChecks.includes(id) !== score[id] < 3))
				throw new Error('Quality scores and failed checks disagree')
			const failed = dimensions.filter((id) =>
				failedChecks.includes(id),
			) as Failure[]
			const metricsPass =
				mechanics.compiled &&
				mechanics.textLines > 0 &&
				!mechanics.overlongLines
			if (!metricsPass) failed.push('metrics')
			trials.push({
				id: test.id,
				mechanics,
				verdict: failed.length ? 'fail' : 'pass',
				score: { ...score, metrics: metricsPass ? 4 : 0 },
				reasons: metricsPass
					? reasons
					: [
							...reasons,
							'NVS compilation, text coverage or line length check failed.',
						],
				failedChecks: failed,
			})
		} catch (error) {
			trials.push({
				id: test.id,
				mechanics,
				verdict: 'undecided',
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}
	const passed = trials.filter(({ verdict }) => verdict === 'pass').length
	const failed = trials.filter(({ verdict }) => verdict === 'fail').length
	const decided = passed + failed
	return {
		trials,
		summary: {
			passed,
			failed,
			undecided: trials.length - decided,
			passRate: decided ? passed / decided : null,
		},
	}
}
