import { writeFileSync } from 'node:fs'

function pdf(pages, image = false) {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		`<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
		image
			? '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Length 1 >>\nstream\nA\nendstream'
			: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		'<< /Title (A local novel) >>',
	]
	for (const [i, lines] of pages.entries()) {
		const content = image
			? 'q 200 0 0 200 10 10 cm /Im1 Do Q'
			: `BT /F1 12 Tf 20 350 Td 18 TL ${lines.map((line) => `(${line}) Tj T*`).join(' ')} ET`
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << ${image ? '/XObject << /Im1 3 0 R >>' : '/Font << /F1 3 0 R >>'} >> /Contents ${6 + i * 2} 0 R >>`,
			`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
		)
	}
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

for (const [name, pages, image] of [
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
]) {
	writeFileSync(new URL(`${name}.pdf`, import.meta.url), pdf(pages, image))
}
