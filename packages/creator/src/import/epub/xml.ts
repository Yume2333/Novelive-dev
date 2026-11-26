import { SaxesParser } from 'saxes'
import { ImportFailureError } from '../../contract/errors'

export interface Element {
	name: string
	attrs: Record<string, string>
	children: (Element | string)[]
}

export function xml(source: string): Element {
	const root: Element = { name: '', attrs: {}, children: [] }
	const stack = [root]
	const parser = new SaxesParser({ xmlns: true })
	parser.on('doctype', (doctype) => {
		if (doctype.includes('['))
			throw new ImportFailureError('epub_doctype', 'EPUB DTD is not supported')
	})
	parser.on('opentag', (tag) => {
		if (stack.length > 128)
			throw new ImportFailureError(
				'epub_limit_exceeded',
				'EPUB XML depth limit exceeded',
			)
		const element: Element = {
			name: tag.local,
			attrs: Object.fromEntries(
				Object.values(tag.attributes).map((attr) => [attr.name, attr.value]),
			),
			children: [],
		}
		stack.at(-1)?.children.push(element)
		stack.push(element)
	})
	parser.on('closetag', () => stack.pop())
	parser.on('text', (text) => stack.at(-1)?.children.push(text))
	parser.on('cdata', (text) => stack.at(-1)?.children.push(text))
	parser.write(source).close()
	return root
}

export function children(node: Element): Element[] {
	return node.children.filter((child) => typeof child !== 'string')
}

export function all(node: Element, name: string): Element[] {
	return children(node).flatMap((child) => [
		...(child.name === name ? [child] : []),
		...all(child, name),
	])
}

export function text(node: Element): string {
	return node.children
		.map((child) => (typeof child === 'string' ? child : text(child)))
		.join('')
		.replace(/\s+/g, ' ')
		.trim()
}
