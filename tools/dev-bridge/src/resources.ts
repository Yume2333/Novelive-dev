import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'

const mime = new Map([
	['.webp', 'image/webp'],
	['.png', 'image/png'],
	['.jpg', 'image/jpeg'],
	['.svg', 'image/svg+xml'],
])

export async function serveResource(
	root: string,
	request: IncomingMessage,
	response: ServerResponse,
) {
	response.setHeader('cross-origin-resource-policy', 'same-site')
	response.setHeader('x-content-type-options', 'nosniff')
	response.setHeader('content-security-policy', "default-src 'none'")
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		response.writeHead(405).end()
		return
	}
	try {
		const path = request.url?.split('?')[0]
		if (!path?.startsWith('/cache/')) throw new Error('Not a cache URL')
		const name = decodeURIComponent(path.slice('/cache/'.length))
		if (
			name.includes('\\') ||
			name.includes('\0') ||
			name.split('/').includes('..') ||
			isAbsolute(name)
		)
			throw new Error('Invalid cache path')
		const base = await realpath(root)
		const candidate = resolve(base, name)
		const type = mime.get(extname(candidate).toLowerCase())
		if (!type) throw new Error('Unsupported resource')
		const target = await realpath(candidate)
		const rel = relative(base, target)
		if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
			throw new Error('Invalid cache path')
		const entry = await stat(target)
		if (!entry.isFile()) throw new Error('Not a file')
		response.writeHead(200, {
			'content-type': type,
			'content-length': entry.size,
		})
		if (request.method === 'HEAD') response.end()
		else
			createReadStream(target)
				.on('error', () => response.destroy())
				.pipe(response)
	} catch {
		response.writeHead(404).end()
	}
}
