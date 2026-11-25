import type { BiblePatch } from '@novelive/format/model'
import type { readBible } from './patch'

type Patch = BiblePatch[number]
type Bible = Awaited<ReturnType<typeof readBible>>
type Named = {
	id: string
	name: string
	originalName?: string
	aliases?: string[]
}

const key = (text: string) =>
	text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '')
const labels = (entry: Named) =>
	[entry.name, entry.originalName, ...(entry.aliases ?? [])].filter(
		(label): label is string => !!label && !!key(label),
	)
const compatibleOriginals = (a: Named, b: Named, normalize = key) =>
	!a.originalName ||
	!b.originalName ||
	normalize(a.originalName) === normalize(b.originalName)
const aliasesOf = (entry: object) =>
	'aliases' in entry && Array.isArray(entry.aliases)
		? entry.aliases.filter(
				(label): label is string => typeof label === 'string',
			)
		: []
const shortLocationVariantLabels = (entry: object) =>
	'variants' in entry && Array.isArray(entry.variants)
		? entry.variants.flatMap((variant) => {
				const description =
					variant &&
					typeof variant === 'object' &&
					'description' in variant &&
					typeof variant.description === 'string'
						? variant.description.trim()
						: ''
				return description &&
					description.length <= 12 &&
					!/[，。；：！？,.!?;:\s]/u.test(description)
					? [description]
					: []
			})
		: []
function names(entries: readonly Named[]) {
	const byLabel = new Map<string, string | null>()
	const spellings = new Set<string>()
	for (const entry of entries)
		for (const label of labels(entry)) {
			const normalized = key(label)
			const prior = byLabel.get(normalized)
			byLabel.set(
				normalized,
				prior === undefined || prior === entry.id ? entry.id : null,
			)
			if ([...normalized].length > 1) {
				spellings.add(label)
				spellings.add(label.normalize('NFKC'))
			}
		}
	const byId = new Map(
		entries
			.slice()
			.reverse()
			.map((entry) => [entry.id, entry]),
	)
	const forms = [...spellings]
		.sort((a, b) => b.length - a.length)
		.map((label) => {
			const literal = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			const start = /^[\p{Script=Latin}\p{N}]/u.test(label)
				? '(?<![\\p{Script=Latin}\\p{N}])'
				: ''
			const end = /[\p{Script=Latin}\p{N}]$/u.test(label)
				? '(?![\\p{Script=Latin}\\p{N}])'
				: ''
			return `${start}${literal}${end}`
		})
	const pattern = forms.length ? new RegExp(forms.join('|'), 'giu') : undefined
	return {
		id: (label: string) => byLabel.get(key(label)) ?? undefined,
		text(text: string, replace: (entry: Named) => string) {
			return pattern
				? text.replace(pattern, (label) => {
						const id = byLabel.get(key(label))
						const entry = id && byId.get(id)
						return entry ? replace(entry) : label
					})
				: text
		},
	}
}

const relationshipTypes: [string, RegExp][] = [
	[
		'parent',
		/^(?:父[子女]|母[子女]|[子女][父母]|親子|亲子|parent(?:child)?|father(?:son|daughter)|mother(?:son|daughter))$/u,
	],
	[
		'spouse',
		/^(?:夫妻|夫婦|夫妇|配偶|婚姻|spouses?|married|husband(?:wife)?|wife(?:husband)?)$/u,
	],
	[
		'sibling',
		/^(?:同胞|手足|兄弟|兄妹|姊妹|姐妹|姊弟|姐弟|siblings?|brother(?:sister)?|sister(?:brother)?)$/u,
	],
	[
		'master-servant',
		/^(?:主[僕仆婢]|世[僕仆]|世[僕仆]與主人|masterservant|servantmaster)$/u,
	],
	[
		'teacher-student',
		/^(?:師徒|师徒|師生|师生|teacherstudent|mentor(?:student|pupil|mentee)|studentteacher)$/u,
	],
]

function relationType(description: string) {
	const heading = description.split(/[:：;；]/u, 1)[0]
	const type = key(heading)
		.replace(/^(?:同胞)(?=兄|姊|姐)/u, '')
		.replace(/(?:關係|关系|relationship)$/u, '')
	return (
		relationshipTypes.find(([, pattern]) => pattern.test(type))?.[0] ??
		(type.length <= 24 && type ? type : key(description))
	)
}

function actionGrams(action: string) {
	const chars = [...action]
	return new Set(chars.slice(2).map((_, i) => chars.slice(i, i + 3).join('')))
}

function sameAction(a: string, b: string) {
	if (!a || !b) return false
	if (a === b) return true
	const left = actionGrams(a)
	const right = actionGrams(b)
	const overlap = [...left].filter((gram) => right.has(gram)).length
	return overlap >= 8 && (2 * overlap) / (left.size + right.size) >= 0.78
}

const foldWidth = (text: string) =>
	text.replace(/[\u3000\uFF01-\uFFDC\uFFE0-\uFFEE]+/gu, (forms) =>
		forms.normalize('NFKC'),
	)
const timelineWording = (event: string) =>
	foldWidth(event)
		.replace(/\s+/gu, ' ')
		.trim()
		.replace(/[.!?。]+$/u, '')
		.trimEnd()

function normalizeNames(patch: BiblePatch, bible: Bible): BiblePatch {
	const existingCharacters = names(bible.character)
	const characters = new Map(bible.character.map((entry) => [entry.id, entry]))
	const characterIds = new Map<string, string>()
	const added = patch.flatMap((item) =>
		item.kind === 'character' && item.op === 'add' ? [item.entry] : [],
	)
	const cooccurs = (a: string, b: string) =>
		patch.some(
			(item) =>
				item.kind === 'relation' &&
				item.op !== 'delete' &&
				item.op !== 'none' &&
				((item.entry.from === a && item.entry.to === b) ||
					(item.entry.from === b && item.entry.to === a)),
		)
	const protectedIds = new Set(
		patch.flatMap((item) =>
			item.kind === 'character' && (item.op === 'delete' || item.op === 'none')
				? [item.entry.id]
				: [],
		),
	)
	for (const entry of added) {
		if (characters.has(entry.id) || protectedIds.has(entry.id)) continue
		const matches = new Set(
			labels(entry).flatMap((label) => existingCharacters.id(label) ?? []),
		)
		const target = existingCharacters.id(entry.name)
		const known = target ? characters.get(target) : undefined
		if (
			known &&
			matches.size === 1 &&
			compatibleOriginals(entry, known) &&
			!cooccurs(entry.id, known.id)
		)
			characterIds.set(entry.id, known.id)
	}
	const character = (id: string) => characterIds.get(id) ?? id
	const separate = new Set<string>()
	for (const item of patch) {
		if (item.kind !== 'relation' || item.op === 'none' || item.op === 'delete')
			continue
		const { from, to } = item.entry
		if (from !== to && character(from) === character(to)) {
			separate.add(from)
			separate.add(to)
		}
	}
	for (const id of separate) characterIds.delete(id)
	const canonicalCharacters = names([
		...bible.character,
		...added.map((entry) => ({ ...entry, id: character(entry.id) })),
	])
	const locationName = (text: string) =>
		canonicalCharacters.text(text, ({ name }) => name)
	const bibleLocations = new Map(
		bible.location.map((entry) => [entry.id, entry]),
	)
	const existingLocations = names(
		bible.location.map((entry) => ({
			...entry,
			aliases: [
				...aliasesOf(entry),
				...shortLocationVariantLabels(entry),
				locationName(entry.name),
			],
		})),
	)
	const pendingLocations = new Map<string, Named>()
	const locationsByName = new Map<
		string,
		{ entry: Named; normalizedOwner: boolean }
	>()
	const fixedLocations = new Set(
		patch.flatMap((item) =>
			item.kind === 'location' && (item.op === 'delete' || item.op === 'none')
				? [item.entry.id]
				: [],
		),
	)
	for (const item of patch) {
		if (
			item.kind !== 'location' ||
			item.op !== 'add' ||
			bibleLocations.has(item.entry.id) ||
			fixedLocations.has(item.entry.id) ||
			pendingLocations.has(item.entry.id)
		)
			continue
		const { entry } = item
		const name = locationName(entry.name)
		const aliasCandidates = [
			entry.name,
			name,
			...aliasesOf(entry),
			...shortLocationVariantLabels(entry),
		]
		const existing = aliasCandidates
			.map((label) => existingLocations.id(label))
			.find((id): id is string => Boolean(id))
		const known = (existing && bibleLocations.get(existing)) || undefined
		const label = key(name)
		const prior = aliasCandidates
			.map((candidate) => locationsByName.get(key(locationName(candidate))))
			.find((found): found is { entry: Named; normalizedOwner: boolean } =>
				Boolean(found),
			)
		const normalizedOwner = name !== entry.name
		const originalKey = (value: string) => key(locationName(value))
		const canonical =
			known && compatibleOriginals(entry, known, originalKey)
				? known
				: prior &&
						compatibleOriginals(entry, prior.entry, originalKey) &&
						(normalizedOwner ||
							prior.normalizedOwner ||
							key(prior.entry.name) !== label)
					? prior.entry
					: { ...entry, name }
		for (const candidate of aliasCandidates) {
			const candidateKey = key(locationName(candidate))
			if (candidateKey && !locationsByName.has(candidateKey))
				locationsByName.set(candidateKey, {
					entry: canonical,
					normalizedOwner,
				})
		}
		pendingLocations.set(entry.id, canonical)
	}
	const characterLabels = new Map<string, Named>()
	for (const entry of added)
		if (!characterLabels.has(entry.id))
			characterLabels.set(
				entry.id,
				characters.get(character(entry.id)) ?? entry,
			)
	const locationAliases = new Map<string, Set<string>>()
	for (const item of patch) {
		if (item.kind !== 'location' || (item.op !== 'add' && item.op !== 'update'))
			continue
		const canonical = pendingLocations.get(item.entry.id)
		if (!canonical || bibleLocations.has(canonical.id)) continue
		const aliases = locationAliases.get(canonical.id) ?? new Set<string>()
		for (const label of [
			item.entry.name,
			...aliasesOf(item.entry),
			...shortLocationVariantLabels(item.entry),
		])
			if (key(label) && key(label) !== key(canonical.name)) aliases.add(label)
		locationAliases.set(canonical.id, aliases)
	}
	return patch.map((item) => {
		if (item.op === 'delete' || item.op === 'none') return item
		switch (item.kind) {
			case 'character': {
				const canonical = characterLabels.get(item.entry.id)
				const id = character(item.entry.id)
				const name =
					canonical && !characters.has(item.entry.id)
						? canonical.name
						: item.entry.name
				const addresses = item.entry.addresses?.map((address) => ({
					...address,
					speakerId: character(address.speakerId),
				}))
				if (
					id === item.entry.id &&
					name === item.entry.name &&
					!item.entry.addresses?.some(
						({ speakerId }) => character(speakerId) !== speakerId,
					)
				)
					return item
				const aliases =
					id === item.entry.id && key(name) !== key(item.entry.name)
						? [...new Set([...(item.entry.aliases ?? []), item.entry.name])]
						: item.entry.aliases
				return {
					...item,
					entry: {
						...item.entry,
						id,
						name,
						...(aliases && { aliases }),
						...(addresses && { addresses }),
					},
				} as Patch
			}
			case 'location': {
				const canonical = pendingLocations.get(item.entry.id)
				if (!canonical) return item
				const { id, name } = canonical
				const aliases = locationAliases.get(id)
				return {
					...item,
					entry: {
						...item.entry,
						id,
						name,
						...(aliases?.size && { aliases: [...aliases] }),
					},
				}
			}
			case 'relation':
				return {
					...item,
					entry: {
						...item.entry,
						from: character(item.entry.from),
						to: character(item.entry.to),
					},
				}
			default:
				return item
		}
	})
}

type Variant = Extract<
	Patch,
	{ kind: 'relation' | 'timeline' | 'foreshadowing' }
>

export function canonicalizeAdditions(
	patch: BiblePatch,
	bible: Bible,
	chapterIds: readonly string[],
): BiblePatch {
	const normalized = normalizeNames(patch, bible)
	const characters = names([
		...bible.character,
		...normalized.flatMap((item) =>
			item.kind === 'character' && item.op === 'add' ? [item.entry] : [],
		),
	])
	const text = (value: string) => characters.text(value, ({ name }) => name)
	const relationText = (
		entry: Extract<Variant, { kind: 'relation' }>['entry'],
	) => ({
		description: text(entry.description),
		...(entry.changes && {
			changes: entry.changes.map((change) =>
				change.field === 'description'
					? { ...change, value: text(change.value) }
					: change,
			),
		}),
	})
	const order = new Map(chapterIds.map((id, i) => [id, i]))
	const protectedIds = new Set([
		...(['relation', 'timeline', 'foreshadowing'] as const).flatMap((kind) =>
			bible[kind].map(({ id }) => `${kind}:${id}`),
		),
		...normalized.flatMap((item) =>
			item.op === 'delete' || item.op === 'none'
				? [`${item.kind}:${item.entry.id}`]
				: [],
		),
	])
	const groups = new Map<
		string,
		{ members: { item: Variant; action: string }[] }[]
	>()
	const canonical = new Map<string, Variant>()
	const replaced = new Set<Variant>()
	const rank = (chapter?: string) => order.get(chapter ?? '') ?? Infinity
	const chapterOf = (item: Variant) => {
		switch (item.kind) {
			case 'relation':
				return item.entry.firstSeenChapter ?? item.observedChapter
			case 'timeline':
				return item.entry.chapterId
			case 'foreshadowing':
				return item.entry.plantedChapter
		}
	}
	const makeKey = (item: Variant) => `${item.kind}:${item.entry.id}`
	for (const item of normalized) {
		if (
			item.op !== 'add' ||
			(item.kind !== 'relation' &&
				item.kind !== 'timeline' &&
				item.kind !== 'foreshadowing') ||
			protectedIds.has(makeKey(item))
		)
			continue
		const text =
			item.kind === 'timeline'
				? foldWidth(item.entry.event)
				: item.entry.description
		const participants = new Set<string>()
		const action = characters.text(text, ({ id, name }) => {
			participants.add(id)
			return item.kind === 'timeline' ? name : ' '
		})
		const groupKey = JSON.stringify(
			item.kind === 'relation'
				? [
						item.kind,
						...[item.entry.from, item.entry.to].sort(),
						relationType(text),
					]
				: [item.kind, chapterOf(item), ...participants],
		)
		const bucket = groups.get(groupKey) ?? []
		const group = bucket.find(({ members }) =>
			members.every(
				({ item: prior, action: previous }) =>
					item.kind === 'relation' ||
					(prior.kind === 'timeline' &&
						item.kind === 'timeline' &&
						(!prior.entry.storyTime ||
							!item.entry.storyTime ||
							prior.entry.storyTime === item.entry.storyTime) &&
						timelineWording(action) === timelineWording(previous)) ||
					(prior.kind === 'foreshadowing' &&
						item.kind === 'foreshadowing' &&
						(!prior.entry.resolvedChapter ||
							!item.entry.resolvedChapter ||
							prior.entry.resolvedChapter === item.entry.resolvedChapter) &&
						(participants.size
							? sameAction(key(action), key(previous))
							: !!key(action) && key(action) === key(previous))),
			),
		)
		if (group) group.members.push({ item, action })
		else bucket.push({ members: [{ item, action }] })
		groups.set(groupKey, bucket)
	}
	const occurrences = new Map<string, number>()
	for (const bucket of groups.values())
		for (const { members } of bucket)
			for (const id of new Set(members.map(({ item }) => makeKey(item))))
				occurrences.set(id, (occurrences.get(id) ?? 0) + 1)
	for (const bucket of groups.values())
		for (const group of bucket) {
			const members = group.members
				.map(({ item }) => item)
				.filter((item) => occurrences.get(makeKey(item)) === 1)
			const item = members[0]
			if (!item || new Set(members.map(makeKey)).size < 2) continue
			const chosen = members.reduce((best, next) =>
				rank(chapterOf(next)) < rank(chapterOf(best)) ||
				(best.kind === 'timeline' &&
					next.kind === 'timeline' &&
					!best.entry.storyTime &&
					next.entry.storyTime) ||
				(best.kind === 'foreshadowing' &&
					next.kind === 'foreshadowing' &&
					!best.entry.resolvedChapter &&
					next.entry.resolvedChapter)
					? next
					: best,
			)
			let representative: Variant
			switch (chosen.kind) {
				case 'relation': {
					const changes = members.flatMap((member) =>
						member.kind === 'relation'
							? (relationText(member.entry).changes ?? [])
							: [],
					)
					const chapter = chapterOf(chosen)
					representative = {
						...chosen,
						entry: {
							...chosen.entry,
							id: item.entry.id,
							description: text(chosen.entry.description),
							...(chapter && { firstSeenChapter: chapter }),
							...(changes.length && {
								changes: [
									...new Map(
										changes.map((change) => [JSON.stringify(change), change]),
									).values(),
								],
							}),
						},
					}
					break
				}
				case 'timeline':
					representative = {
						...chosen,
						entry: {
							...chosen.entry,
							id: item.entry.id,
							event: text(chosen.entry.event),
						},
					}
					break
				case 'foreshadowing':
					representative = {
						...chosen,
						entry: {
							...chosen.entry,
							id: item.entry.id,
							description: text(chosen.entry.description),
						},
					}
			}
			for (const member of members) {
				canonical.set(makeKey(member), representative)
				replaced.add(member)
			}
		}
	const emitted = new Set<Variant>()
	return normalized.flatMap((item): BiblePatch => {
		if (
			item.kind !== 'relation' &&
			item.kind !== 'timeline' &&
			item.kind !== 'foreshadowing'
		)
			return [item]
		const representative = canonical.get(makeKey(item))
		if (!representative) return [item]
		if (replaced.has(item)) {
			if (emitted.has(representative)) return []
			emitted.add(representative)
			return [representative]
		}
		if (item.op !== 'update') return [item]
		if (item.kind === 'relation' && representative.kind === 'relation')
			return [
				{
					...item,
					entry: {
						...item.entry,
						...relationText(item.entry),
						id: representative.entry.id,
						from: representative.entry.from,
						to: representative.entry.to,
					},
				},
			]
		return [
			{
				...item,
				entry: { ...item.entry, id: representative.entry.id },
			} as Patch,
		]
	})
}
