import { packageEntry } from '../contract'
import { corrupt } from './error'

const windowsDevice =
	/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$) *(?:\.|$)/i

export class PackagePaths {
	private readonly paths = new Map<string, { name: string; file: boolean }>()

	add(path: string) {
		const rule = packageEntry(path)
		if (!rule) throw corrupt(path, 'unexpected or unsafe entry name')

		const parts = path.split('/')
		let name = ''
		for (const [index, part] of parts.entries()) {
			if (/[<>"|?*]/.test(part) || windowsDevice.test(part))
				throw corrupt(path, 'entry name is not portable')
			name += (index ? '/' : '') + part
			const key = name.toUpperCase().normalize('NFC')
			const existing = this.paths.get(key)
			const file = index === parts.length - 1
			if (existing && (existing.name !== name || file || existing.file))
				throw corrupt(path, 'duplicate or conflicting entry name')
			this.paths.set(key, { name, file })
		}
		return rule
	}
}
