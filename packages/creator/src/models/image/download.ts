import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent } from 'undici'

const blocked = new BlockList()
for (const [address, bits] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 3],
] as const)
	blocked.addSubnet(address, bits, 'ipv4')
blocked.addSubnet('2001::', 32, 'ipv6')
blocked.addSubnet('2002::', 16, 'ipv6')

const publicIPv6 = new BlockList()
publicIPv6.addSubnet('2000::', 3, 'ipv6')
publicIPv6.addSubnet('::ffff:0:0', 96, 'ipv6')

function publicAddress(address: string) {
	const family = isIP(address)
	if (family === 4) return !blocked.check(address, 'ipv4')
	return (
		family === 6 &&
		publicIPv6.check(address, 'ipv6') &&
		!blocked.check(address, 'ipv6')
	)
}

const publicAgent = new Agent({
	connect: {
		lookup(hostname, options, callback) {
			lookup(hostname, { ...options, all: true }, (error, addresses) => {
				if (error) return callback(error, '', 0)
				if (
					!addresses.length ||
					addresses.some(({ address }) => !publicAddress(address))
				)
					return callback(
						new Error('Image download requires a public address'),
						'',
						0,
					)
				if (options.all) callback(null, addresses)
				else callback(null, addresses[0].address, addresses[0].family)
			})
		},
	},
})

export function imageDownloadUpstream(
	baseUrl: string,
	upstream: typeof fetch = globalThis.fetch,
): typeof fetch {
	const origin = new URL(baseUrl).origin
	return async (input, init) => {
		let url = new URL(input instanceof Request ? input.url : input)
		for (let redirects = 0; redirects <= 5; redirects++) {
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password
			)
				throw new Error('Invalid image download URL')
			const external = url.origin !== origin
			const address = url.hostname.replace(/^\[|\]$/g, '')
			if (external && isIP(address) && !publicAddress(address))
				throw new Error('Image download requires a public address')
			const options = {
				...init,
				redirect: 'manual' as const,
				dispatcher: external ? publicAgent : undefined,
			}
			const response = await upstream(url, options)
			const location = response.headers.get('location')
			if (!location || ![301, 302, 303, 307, 308].includes(response.status))
				return response
			await response.body?.cancel()
			url = new URL(location, url)
		}
		throw new Error('Too many image download redirects')
	}
}
