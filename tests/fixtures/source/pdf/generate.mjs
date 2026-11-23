import { writeFileSync } from 'node:fs'

function pdf(pages, image = false, cjk = false) {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
		image
			? '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Length 1 >>\nstream\nA\nendstream'
			: cjk
				? `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${5 + pages.length * 2} 0 R] >>`
				: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		'<< /Title (A local novel) >>',
	]
	for (const [i, lines] of pages.entries()) {
		const content = image
			? 'q 200 0 0 200 10 10 cm /Im1 Do Q'
			: lines
					.map((line, index) => {
						const {
							text,
							x = 20,
							y = 350 - index * 18,
						} = typeof line === 'string' ? { text: line } : line
						const encoded = cjk
							? `<${Array.from(text, (char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')}>`
							: `(${text.replace(/[\\()]/g, '\\$&')})`
						return `BT /F1 12 Tf ${x} ${y} Td ${encoded} Tj ET`
					})
					.join('\n')
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << ${image ? '/XObject << /Im1 3 0 R >>' : '/Font << /F1 3 0 R >>'} >> /Contents ${6 + i * 2} 0 R >>`,
			`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		)
	}
	if (cjk)
		objects.push(
			'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 >>',
		)
	let result = '%PDF-1.4\n'
	const offsets = objects.map((object, i) => {
		const offset = result.length
		result += `${i + 1} 0 obj\n${object}\nendobj\n`
		return `${String(offset).padStart(10, '0')} 00000 n \n`
	})
	const xref = result.length
	result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return result
}

for (const [name, pages, image, cjk] of [
	[
		'sparse-folios',
		[
			['第一章 风起', '正文。'],
			['跨页正文。', '- 12 -'],
			['第 13 页', '末页正文。'],
		],
		false,
		true,
	],
	[
		'body-heading-header',
		[
			['Chapter 1', 'The tale begins', 'and travels onward'],
			[
				{ text: 'Chapter 1', y: 380 },
				{ text: 'through the village', y: 326 },
				{ text: 'toward the river', y: 308 },
				{ text: 'and ends.', y: 290 },
			],
		],
		false,
	],
	[
		'many-folios',
		Array.from({ length: 40 }, (_, i) => [
			{ text: String(i + 10), y: 380 },
			{ text: i === 0 ? 'Chapter 1' : 'A body sentence.', y: 326 },
			{ text: 'More body prose.', y: 308 },
			{ text: 'An ending.', y: 290 },
		]),
		false,
	],
	[
		'wrapped-notes',
		[
			['Chapter 1', 'Body sentence.', '[1] A note begins', 'and continues'],
			['New page prose', 'continues here.'],
		],
		false,
	],
	[
		'zone-chapters',
		['1', '5', '9'].map((text) => [
			{ text, y: 380 },
			{ text: 'A chapter begins.', y: 326 },
			{ text: 'It continues.', y: 308 },
			{ text: 'It ends.', y: 290 },
		]),
		false,
	],
	[
		'two-folios',
		['10', '11'].map((text) => [
			{ text, y: 380 },
			{ text: 'A sentence.', y: 326 },
			{ text: 'Another sentence.', y: 308 },
			{ text: 'An ending.', y: 290 },
		]),
		false,
	],
	[
		'repeated-prose',
		[
			['Chapter 1', 'A first sentence.', 'The refrain.'],
			['Another sentence.', 'An answer.', 'The refrain.'],
		],
		false,
	],
	[
		'left-folio',
		[
			[
				{ text: 'Chapter 1', x: 60, y: 320 },
				{ text: 'The first line', x: 60, y: 302 },
				{ text: 'continues here.', x: 60, y: 284 },
				{ text: '- 12 -', x: 10, y: 40 },
			],
		],
		false,
	],
	[
		'running-edges',
		[
			['The story', 'begins', 'and'],
			['continues', 'on', 'and'],
			['on', 'to its', 'ending.'],
		],
		false,
	],
	[
		'text',
		[
			['Chapter 1', 'The first page ends here.'],
			['The story continues.', 'Chapter 2', 'A second chapter.'],
		],
		false,
	],
	['image-only', [[]], true],
	['blank', [[]], false],
	['plain', [['No heading on this page.'], ['Still the same chapter.']], false],
	[
		'notes',
		[
			[
				'Chapter 1',
				'Unfinished prose',
				'[1] Translator note',
				'Body continues.',
				'www.example.com',
				'Last body sentence.',
			],
		],
		false,
	],
	[
		'cjk-wrap',
		[
			['第一章 风起', '他走过长长的街道', '看见远处的灯火正在'],
			['慢慢亮起。', '她站在门外等待。', '第 12 页'],
		],
		false,
		true,
	],
	[
		'english-wrap',
		[
			[
				'- 1 -',
				'Chapter 1',
				'The traveler followed the inter-',
				'national road toward the',
			],
			['- 12 -', 'quiet village.', 'Another sentence.', '- 13 -'],
		],
		false,
	],
	[
		'layout',
		[
			[
				{ text: 'Chapter 1', y: 350 },
				{ text: 'An unfinished thought', y: 332 },
				{ text: 'with a soft wrap', y: 314 },
				{ text: 'A new paragraph', y: 278 },
				{ text: 'continued here', y: 260 },
				{ text: 'Indented start', x: 44, y: 242 },
				{ text: 'ends here.', y: 224 },
			],
		],
		false,
	],
	[
		'numbered-chapters',
		[
			['1', 'First chapter.'],
			['2', 'Second chapter.'],
			['3', 'Third chapter.'],
		],
		false,
	],
	[
		'bare-page-numbers',
		[
			[
				{ text: 'Chapter 1' },
				{ text: 'The story goes on' },
				{ text: '10', x: 180 },
			],
			[{ text: 'across the page.' }, { text: '11', x: 180 }],
		],
		false,
	],
]) {
	let layout =
		name === 'running-edges'
			? pages.map((lines) => [
					{ text: 'Chapter 2', y: 380 },
					...lines.map((text, i) => ({ text, y: 326 - i * 18 })),
					{ text: 'A local novel', y: 40 },
				])
			: pages
	if (name === 'notes')
		layout = pages.map((lines) =>
			lines.map((text, i) => ({ text, x: i === 3 ? 44 : 20 })),
		)
	if (name === 'bare-page-numbers')
		layout = [0, 1, 2].map((i) => [
			{ text: String(10 + i), x: 5, y: 380 },
			{ text: i === 0 ? 'Chapter 1' : 'The story continues.', y: 326 },
			{ text: 'Some more prose.', y: 308 },
			{ text: 'End of this page.', y: 290 },
		])
	if (name === 'english-wrap' || name === 'cjk-wrap')
		layout = pages.map((lines) =>
			lines.map((line, i) => ({
				text: line,
				y: /^(?:- \d+ -|第 \d+ 页)$/.test(line)
					? i === 0
						? 380
						: 40
					: 326 - i * 18,
			})),
		)
	writeFileSync(
		new URL(`${name}.pdf`, import.meta.url),
		pdf(layout, image, cjk),
	)
}
