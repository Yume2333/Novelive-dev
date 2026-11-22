import type { Character } from '@novelive/format/model'
import type { ArtJob } from './plan'

export const finish =
	'Finish this as a final, fully cleaned-up illustration: inked line art with no sketch lines, stray hairs or broken strokes; flat base colors with smooth airbrushed gradients; highlights placed as a few clean, deliberate shapes, as in Image 1. Put fine detail only on the face, eyes, hair ornaments and the main object of the scene; keep clothing folds, background and secondary areas simpler, with fewer lines. Every outline is one clean stroke, not several sketchy ones; hair strands end in clean tapered points; lines never break or wobble. large simple color masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppress micro-texture and micro-contrast, no unnecessary specular highlights, except that hair highlights, eyes, the gradients, and the brushwork and stroke texture of Image 1 stay exactly as in Image 1.'

const descriptions = {
	character: 'Draw a costume base sprite.',
	location: 'Draw a location base background.',
	cg: 'Draw a full scene illustration.',
	expression:
		'Edit only the facial features specified below in the base sprite.',
	variant: 'Edit only the specified conditions in the base background.',
	'main-visual':
		'Draw a landscape main visual that establishes the work’s art style.',
}

export type Drawing = {
	kind: ArtJob['kind'] | 'main-visual'
	description: string
	style: string
	references: {
		path: string
		role: 'style' | 'base' | 'identity' | 'location'
		label: string
	}[]
	characters: readonly Character[]
	keep: readonly string[]
}

export function drawingPrompt(
	drawing: Drawing,
	content: string,
	feedback: string,
) {
	const { kind, style, references, characters, keep } = drawing
	const styleIndices = references.flatMap(({ role }, index) =>
		role === 'style' ? [index + 1] : [],
	)
	const numbered =
		styleIndices.length === 1
			? `Image ${styleIndices[0]}`
			: `Images ${styleIndices[0]}–${styleIndices.at(-1)}`
	const declaration = styleIndices.length
		? `${numbered} ${styleIndices.length === 1 ? 'is a style reference' : 'are style references'} only. Match how ${styleIndices.length === 1 ? 'it is' : 'they are'} drawn: line quality, coloring and shading method, brushwork, level of detail, lighting and overall color treatment, including whether ${styleIndices.length === 1 ? 'it is' : 'they are'} in color or monochrome. Do not copy the people in ${styleIndices.length === 1 ? 'it' : 'them'}: face, hairstyle, hair and eye color, outfit and accessories come only from the description below.`
		: ''
	const other = references.flatMap(({ role, label }, index) =>
		role === 'style' ? [] : [`Image ${index + 1} is the ${label}.`],
	)
	const appearance = characters.flatMap(({ name, appearance }) =>
		appearance
			? [
					`${name}: ${appearance.description} ${appearance.anchorFeatures?.join('；') ?? ''}`,
				]
			: [],
	)
	const colors =
		kind === 'character' || kind === 'cg'
			? characters.flatMap(({ name, appearance }) => {
					const color = appearance?.keyColors
					return color
						? [
								`${name}: ${color.hair}, ${color.eyes}, ${color.clothing}. These colors come from the description, not from the style references; in a monochrome style, show them as tones.`,
							]
						: []
				})
			: []
	const framing =
		kind === 'character'
			? 'Center the character from the top of the head to above the knees, with a little headroom and the legs cut by the bottom edge above the knees. Use a transparent background without a floor or shadow. Match semitransparent edges to adjacent clothing or skin.'
			: kind === 'expression' || kind === 'variant'
				? `Keep everything else aligned to Image 1: ${keep.join('；')}.`
				: `Keep the subject in the central 4:3 safe area of the 16:9 canvas; extend only the surroundings to the left and right.${kind === 'location' ? ' Show an empty scene without people.' : ''}`
	const suffix = styleIndices.length
		? finish.replaceAll('Image 1', numbered)
		: finish
				.replaceAll(', as in Image 1', '')
				.replaceAll(' of Image 1', '')
				.replace(
					' exactly as in Image 1',
					' consistent with the described style',
				)
	return [
		[
			declaration,
			...other,
			descriptions[kind],
			content,
			feedback,
			...appearance,
			style,
			framing,
		]
			.filter(Boolean)
			.join(' '),
		colors.join(' '),
		suffix,
	]
		.filter(Boolean)
		.join('\n')
}
