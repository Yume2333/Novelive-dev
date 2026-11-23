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
				'1',
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
]) {
	writeFileSync(new URL(`${name}.pdf`, import.meta.url), pdf(pages, image, cjk))
}
