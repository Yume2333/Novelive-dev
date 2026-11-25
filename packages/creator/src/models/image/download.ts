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
// Ranges that must NEVER be relaxed by the same-network allowance: cloud
// metadata endpoints and link-local addresses are a classic SSRF target, so a
// non-public baseUrl may not pull them into scope.
const sensitive = new BlockList()
sensitive.addSubnet('169.254.0.0', 16, 'ipv4')
sensitive.addSubnet('fe80::', 10, 'ipv6')
sensitive.addSubnet('fd00:ec2::', 80, 'ipv6')

function sensitiveAddress(address: string) {
	const family = isIP(address)
	if (family === 4) return sensitive.check(address, 'ipv4')
	if (family === 6) return sensitive.check(expandIPv6(address), 'ipv6')
	return false
}

// Expand a (possibly compressed) IPv6 literal into full 8-hextet form so the
// first-4-hextets comparison cannot be fooled by `::` shorthand.
function expandIPv6(address: string) {
	const [left, right] = address.split('::')
	const head = left ? left.split(':') : []
	const tail = right !== undefined ? (right ? right.split(':') : []) : null
	if (tail === null) return head.map((part) => part.padStart(4, '0')).join(':')
	const missing = 8 - (head.length + tail.length)
	return [...head, ...Array<string>(missing).fill('0'), ...tail]
		.map((part) => part.padStart(4, '0'))
		.join(':')
}

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

function sameNetwork(address: string, base: string) {
	const family = isIP(address)
	if (!family || isIP(base) !== family) return false
	if (family === 4)
		return (
			address.split('.').slice(0, 2).join('.') ===
			base.split('.').slice(0, 2).join('.')
		)
	const a = expandIPv6(address)
	const b = expandIPv6(base)
	return (
		a.split(':').slice(0, 4).join(':') === b.split(':').slice(0, 4).join(':')
	)
}

function downloadAgent(baseUrl: string) {
	const baseHost = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
	return new Agent({
		connect: {
			lookup(hostname, options, callback) {
				lookup(hostname, { ...options, all: true }, (error, addresses) => {
					if (error) return callback(error, '', 0)
					if (!addresses.length)
						return callback(
							new Error('Image download requires a public address'),
							'',
							0,
						)
					lookup(baseHost, { all: true }, (baseError, baseAddresses) => {
						const privateBase = (baseAddresses ?? [])
							.map(({ address }) => address)
							.filter(
								(address) =>
									!publicAddress(address) && !sensitiveAddress(address),
							)
						const blockedAddress = addresses.some(
							({ address }) =>
								!publicAddress(address) &&
								(sensitiveAddress(address) ||
									baseError ||
									!privateBase.length ||
									!privateBase.some((base) => sameNetwork(address, base))),
						)
						if (blockedAddress)
							return callback(
								new Error('Image download requires a public address'),
								'',
								0,
							)
						if (options.all) callback(null, addresses)
						else callback(null, addresses[0].address, addresses[0].family)
					})
				})
			},
		},
	})
}

const agents = new Map<string, Agent>()
function agentFor(baseUrl: string) {
	const key = new URL(baseUrl).origin
	let agent = agents.get(key)
	if (!agent) {
		agent = downloadAgent(baseUrl)
		agents.set(key, agent)
	}
	return agent
}

export function imageDownloadUpstream(
	baseUrl: string,
	upstream: typeof fetch = globalThis.fetch,
): typeof fetch {
	const origin = new URL(baseUrl).origin
	return async (input, init) => {
		let url = new URL(input instanceof Request ? input.url : input)
		const signal =
			init?.signal ?? (input instanceof Request ? input.signal : undefined)
		for (let redirects = 0; redirects <= 5; redirects++) {
			if (
				!['http:', 'https:'].includes(url.protocol) ||
				url.username ||
				url.password
			)
				throw new Error('Invalid image download URL')
			const external = url.origin !== origin
			const address = url.hostname.replace(/^\[|\]$/g, '')
			const baseAddress = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
			if (
				external &&
				isIP(address) &&
				!publicAddress(address) &&
				(sensitiveAddress(address) ||
					!(
						isIP(baseAddress) &&
						!publicAddress(baseAddress) &&
						!sensitiveAddress(baseAddress) &&
						sameNetwork(address, baseAddress)
					))
			)
				throw new Error('Image download requires a public address')
			const options = {
				...init,
				signal,
				redirect: 'manual' as const,
				dispatcher: external ? agentFor(baseUrl) : undefined,
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
