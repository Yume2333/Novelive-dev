export function viteFileUrl(file: URL) {
	return `/@fs${file.pathname}`
}
