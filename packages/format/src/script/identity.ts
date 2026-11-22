import type { Diagnostic, Scene, ScriptLine } from './schema'

type IdSource = (bytes: 2 | 4) => string
const randomId: IdSource = (bytes) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
		value.toString(16).padStart(2, '0'),
	).join('')
export interface IdentityOptions {
	previous?: readonly Scene[]
	sceneIds?: readonly string[]
	makeId?: IdSource
}

function allocate(bytes: 2 | 4, taken: Set<string>, makeId: IdSource) {
	const shape = bytes === 2 ? /^[0-9a-f]{4}$/ : /^[0-9a-f]{8}$/
	for (let i = 0; i < 64; i++) {
		const next = makeId(bytes)
		if (shape.test(next) && !taken.has(next)) {
			taken.add(next)
			return next
		}
	}
	for (let i = 0; i <= taken.size; i++) {
		const next = i.toString(16).padStart(bytes * 2, '0')
		if (!shape.test(next)) break
		if (!taken.has(next)) {
			taken.add(next)
			return next
		}
	}
}

function prefix(line: ScriptLine) {
	return line.type === 'text'
		? JSON.stringify([line.kind, line.speaker, line.alias])
		: line.type
}

export function assignScriptIds(
	scenes: readonly Scene[],
	options: IdentityOptions = {},
): { scenes: Scene[]; diagnostics: Diagnostic[] } {
	const { previous = [], makeId = randomId, sceneIds } = options
	const diagnostics: Diagnostic[] = []
	const reserved = new Set(
		previous.flatMap((scene) => (scene.id ? [scene.id] : [])),
	)
	const used = new Set<string>()
	for (const [i, scene] of scenes.entries()) {
		const id = sceneIds?.[i] ?? scene.id
		if (id) reserved.add(id)
	}
	const fail = (
		code: Diagnostic['code'],
		at: Pick<Scene, 'line' | 'col'>,
		message: string,
	) => {
		diagnostics.push({
			code,
			line: at.line,
			col: at.col,
			message,
			hint: '修正重复或无效的 ID；新场景也可以让应用分配。',
		})
	}
	return {
		diagnostics,
		scenes: scenes.map((scene, i) => {
			let id = sceneIds?.[i] ?? scene.id
			const prior =
				id === undefined
					? previous[i]?.title === scene.title
						? previous[i]
						: undefined
					: previous.find((entry) => entry.id === id)
			id ??= prior?.id ?? allocate(4, reserved, makeId)
			if (!id) fail('E_ID_EXHAUSTED', scene, '没有可用的场景 ID。')
			else if (!/^[0-9a-f]{8}$/.test(id))
				fail('E_ID', scene, '场景 ID 必须为八位小写十六进制。')
			else if (used.has(id)) fail('E_DUPLICATE_ID', scene, '场景 ID 重复。')
			else used.add(id)
			const taken = new Set(
				prior?.lines.flatMap((line) =>
					line.type !== 'action' && line.id ? [line.id] : [],
				),
			)
			const explicit = new Set(
				scene.lines.flatMap((line) =>
					line.type !== 'action' && line.id ? [line.id] : [],
				),
			)
			for (const lineId of explicit) taken.add(lineId)
			const lines = scene.lines.map((line, j) => {
				if (line.type === 'action' || line.id) return line
				const old = prior?.lines[j]
				const oldId =
					old &&
					old.type !== 'action' &&
					old.id &&
					prefix(old) === prefix(line) &&
					!explicit.has(old.id)
						? old.id
						: undefined
				const lineId = oldId ?? allocate(2, taken, makeId)
				if (!lineId) fail('E_ID_EXHAUSTED', line, '场景已用尽四位句子 ID。')
				return lineId ? { ...line, id: lineId } : line
			})
			return { ...scene, ...(id ? { id } : {}), lines }
		}),
	}
}
