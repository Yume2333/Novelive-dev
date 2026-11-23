import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageContent } from '@earendil-works/pi-ai'
import type { CommandInput } from '../contract'
import { type Attachment, chatError } from './store'

const maxBytes = 10 * 1024 * 1024
const extensions = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
}

function matches(bytes: Buffer, mime: Attachment['mimeType']) {
	switch (mime) {
		case 'image/png':
			return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
		case 'image/jpeg':
			return bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
		case 'image/webp':
			return (
				bytes.toString('ascii', 0, 4) === 'RIFF' &&
				bytes.toString('ascii', 8, 12) === 'WEBP'
			)
		case 'image/gif':
			return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
	}
}

function cachePath(id: string, mime: Attachment['mimeType']) {
	const extension = extensions[mime]
	if (!/^[a-f0-9-]{36}$/.test(id) || !extension)
		throw chatError('invalid_config', '无效的会话附件')
	return `chat/${id}.${extension}`
}

export class ChatAttachments {
	constructor(private readonly directory: string) {}

	async create({
		name,
		mimeType,
		base64,
	}: CommandInput<'chat.attach'>): Promise<Attachment> {
		if (base64.length > Math.ceil(maxBytes / 3) * 4)
			throw chatError('invalid_config', '附件不能超过 10 MiB')
		const data = Buffer.from(base64, 'base64')
		if (
			data.length > maxBytes ||
			data.toString('base64') !== base64 ||
			!matches(data, mimeType)
		)
			throw chatError('invalid_config', '附件内容与图片格式不符')
		const id = randomUUID()
		const path = cachePath(id, mimeType)
		await mkdir(join(this.directory, 'chat'), { recursive: true })
		await writeFile(join(this.directory, path), data, {
			flag: 'wx',
			mode: 0o600,
		})
		return { id, name, mimeType, cachePath: path }
	}

	async image({ id, mimeType }: Attachment): Promise<ImageContent> {
		const bytes = await readFile(join(this.directory, cachePath(id, mimeType)))
		return { type: 'image', mimeType, data: bytes.toString('base64') }
	}

	remove({ id, mimeType }: Attachment) {
		return rm(join(this.directory, cachePath(id, mimeType)), { force: true })
	}
}
