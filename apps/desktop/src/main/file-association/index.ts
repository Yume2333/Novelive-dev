import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'

function parsePackageArg(arg: string, cwd: string) {
	if (/^file:\/\//i.test(arg)) {
		try {
			return fileURLToPath(arg)
		} catch {
			return null
		}
	}
	return resolve(cwd, arg)
}

export function collectPackageOpens(notify: () => void) {
	const files: string[] = []
	function enqueue(path: string) {
		if (!/\.novelive$/i.test(path)) return
		files.push(path)
		notify()
	}
	function collect(args: string[], cwd: string) {
		for (const arg of args) {
			if (arg.startsWith('-')) continue
			const path = parsePackageArg(arg, cwd)
			if (path) enqueue(path)
		}
	}
	app.on('open-file', (event, path) => {
		event.preventDefault()
		enqueue(path)
	})
	collect(process.argv.slice(1), process.cwd())
	return {
		collect,
		take: () => files.shift() ?? null,
		hasFiles: () => files.length > 0,
	}
}
