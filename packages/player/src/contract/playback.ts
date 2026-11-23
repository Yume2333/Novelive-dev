import type {
	Advance,
	Beat,
	CompiledAction,
	CompiledScene,
	Inline,
	TextLine,
} from '@novelive/format/script'

export interface SentenceRef {
	chapterId: string
	sceneId: string
	sentenceId: string
}

export interface PlayerText {
	kind: TextLine['kind']
	speaker?: string
	displayName?: string
	content: readonly Inline[]
}

export interface PlayerSettings {
	textMillisecondsPerCharacter: number
	autoPlaySpeedMultiplier: number
	fontSize: number
	dialogueOpacity: number
	dialogueStyle: string
	skipRead: boolean
	fullscreen: boolean
}

type BeatCue =
	| { kind: 'text'; position: SentenceRef; text: PlayerText }
	| { kind: 'wait'; lineId: string }
	| { kind: 'stage' }

export interface PlaybackBeat {
	sceneId: string
	actions: readonly CompiledAction[]
	cue: BeatCue
	advance: Advance
}

function playbackCue(
	chapterId: string,
	sceneId: string,
	line: Beat['line'],
	speakerNames: Readonly<Record<string, string>>,
): BeatCue {
	if (!line) return { kind: 'stage' }
	if (line.id === undefined) throw new Error('编译后的台词或等待缺少 ID')
	if (line.type === 'wait') return { kind: 'wait', lineId: line.id }
	const { kind, speaker, alias, content } = line
	const displayName =
		alias ??
		(speaker !== undefined && Object.hasOwn(speakerNames, speaker)
			? speakerNames[speaker]
			: speaker)
	return {
		kind: 'text',
		position: { chapterId, sceneId, sentenceId: line.id },
		text: {
			kind,
			content,
			...(speaker === undefined ? {} : { speaker }),
			...(displayName === undefined ? {} : { displayName }),
		},
	}
}

export function toPlaybackBeats(
	chapterId: string,
	scenes: readonly CompiledScene[],
	speakerNames: Readonly<Record<string, string>>,
): PlaybackBeat[] {
	return scenes.flatMap(({ scene, beats }) => {
		const sceneId = scene.id
		if (sceneId === undefined) throw new Error('编译后的场景缺少 ID')
		return beats.map(({ actions, line, advance }) => ({
			sceneId,
			actions,
			cue: playbackCue(chapterId, sceneId, line, speakerNames),
			advance,
		}))
	})
}
