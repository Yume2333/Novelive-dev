import type { TextSlot } from '../config/schema'

export const textUsageSlots = new WeakMap<object, TextSlot>()

export function withTextSlot<T extends object>(
	connection: T,
	slot: TextSlot,
): T {
	textUsageSlots.set(connection, slot)
	return connection
}
