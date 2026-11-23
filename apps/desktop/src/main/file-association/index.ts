import { resolve } from 'node:path'
import { app } from 'electron'

export function collectPackageOpens(notify: () => void) {
	const files: string[] = []
	function enqueue(path: string) {
		if (!/\.novelive$/i.test(path)) return
		files.push(path)
		notify()
	}
	function collect(args: string[], cwd: string) {
		for (const arg of args) if (!arg.startsWith('-')) enqueue(resolve(cwd, arg))
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
