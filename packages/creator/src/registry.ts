import { compile } from '@earendil-works/pi-schema'
import {
	type Command,
	type CommandInput,
	type CommandOutput,
	commands,
} from './contract'

type Handler<K extends Command> = (
	payload: CommandInput<K>,
	signal: AbortSignal,
) => CommandOutput<K> | Promise<CommandOutput<K>>

export function createRegistry() {
	const handlers = new Map<
		string,
		(payload: unknown, signal: AbortSignal) => Promise<unknown>
	>()

	return {
		register<K extends Command>(name: K, handler: Handler<K>) {
			const input = compile(commands[name].input)
			const output = compile(commands[name].output)
			handlers.set(name, async (payload, signal) => {
				if (!input.check(payload)) {
					throw { code: 'invalid_config', message: '命令参数无效' }
				}
				const result = await handler(payload as CommandInput<K>, signal)
				if (!output.check(result)) {
					throw { code: 'internal', message: '命令返回值无效' }
				}
				return result
			})
		},
		async run(name: string, payload: unknown, signal: AbortSignal) {
			const handler = handlers.get(name)
			if (!handler) {
				throw { code: 'unsupported', message: '命令未注册' }
			}
			return handler(payload, signal)
		},
	}
}
