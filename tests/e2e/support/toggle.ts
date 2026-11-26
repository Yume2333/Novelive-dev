import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Shared `Toggle` is a `role="switch"` button (not a checkbox input), so
 * Playwright's `check()`/`uncheck()` do not apply. `setSwitch` preserves the
 * same idempotent semantics: it clicks only when the current `aria-checked`
 * state differs from the target, then asserts the final state.
 */
export async function setSwitch(locator: Locator, on: boolean) {
	const current = await locator.getAttribute('aria-checked')
	if ((current === 'true') !== on) await locator.click()
	await expect(locator).toHaveAttribute('aria-checked', on ? 'true' : 'false')
}

/** Asserts the switch state, mirroring `toBeChecked()`/`not.toBeChecked()`. */
export async function expectSwitch(locator: Locator, on: boolean) {
	await expect(locator).toHaveAttribute('aria-checked', on ? 'true' : 'false')
}
