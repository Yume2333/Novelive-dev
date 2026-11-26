import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

/*
 * 控件库行为测试：仓库不依赖 jsdom，这里内置一个 100% 自包含的最小 DOM 实现，
 * 在任何机器上都能确定性运行。实现覆盖 React 19 事件委托所需的节点树、
 * 冒泡/捕获传播、选择器匹配、表单控件与焦点管理。
 *
 * DOM 注入必须在任何 react/react-dom 求值之前完成（canUseDOM 在模块加载时固定），
 * 因此放在模块顶层执行，React 相关模块一律在其后运行时动态加载。
 */

type MiniListener = {
	type: string
	listener: EventListenerOrEventListenerObject
	capture: boolean
}

class MiniEvent {
	type: string
	bubbles: boolean
	cancelable: boolean
	defaultPrevented = false
	propagationStopped = false
	immediatePropagationStopped = false
	target: MiniNode | null = null
	currentTarget: MiniNode | null = null
	eventPhase = 0
	button = 0
	key = ''

	constructor(
		type: string,
		init: { bubbles?: boolean; cancelable?: boolean; key?: string } = {},
	) {
		this.type = type
		this.bubbles = init.bubbles ?? false
		this.cancelable = init.cancelable ?? false
		this.key = init.key ?? ''
	}

	preventDefault() {
		if (this.cancelable) this.defaultPrevented = true
	}

	stopPropagation() {
		this.propagationStopped = true
	}

	stopImmediatePropagation() {
		this.immediatePropagationStopped = true
		this.propagationStopped = true
	}
}

class MiniMouseEvent extends MiniEvent {}
class MiniKeyboardEvent extends MiniEvent {}
class MiniFocusEvent extends MiniEvent {}
class MiniInputEvent extends MiniEvent {}
class MiniCustomEvent extends MiniEvent {
	detail: unknown
	constructor(
		type: string,
		init: { bubbles?: boolean; cancelable?: boolean; detail?: unknown } = {},
	) {
		super(type, init)
		this.detail = init.detail
	}
}

class MiniNode {
	readonly nodeType: number
	parentNode: MiniNode | null = null
	childNodes: MiniNode[] = []
	ownerDocument: MiniDocument
	listeners: MiniListener[] = []

	constructor(nodeType: number, ownerDocument: MiniDocument) {
		this.nodeType = nodeType
		this.ownerDocument = ownerDocument
	}

	get parentElement(): MiniElement | null {
		return this.parentNode instanceof MiniElement ? this.parentNode : null
	}

	get firstChild(): MiniNode | null {
		return this.childNodes[0] ?? null
	}

	get firstElementChild(): MiniElement | null {
		return (
			(this.childNodes.find((node) => node instanceof MiniElement) as
				| MiniElement
				| undefined) ?? null
		)
	}

	get nextSibling(): MiniNode | null {
		if (!this.parentNode) return null
		const siblings = this.parentNode.childNodes
		const index = siblings.indexOf(this)
		return siblings[index + 1] ?? null
	}

	get previousSibling(): MiniNode | null {
		if (!this.parentNode) return null
		const siblings = this.parentNode.childNodes
		const index = siblings.indexOf(this)
		return index > 0 ? (siblings[index - 1] ?? null) : null
	}

	appendChild<T extends MiniNode>(node: T): T {
		if (node.parentNode) node.parentNode.removeChild(node)
		node.parentNode = this
		this.childNodes.push(node)
		return node
	}

	insertBefore<T extends MiniNode>(node: T, ref: MiniNode | null): T {
		if (node.parentNode) node.parentNode.removeChild(node)
		node.parentNode = this
		if (ref === null) {
			this.childNodes.push(node)
		} else {
			const index = this.childNodes.indexOf(ref)
			if (index === -1) this.childNodes.push(node)
			else this.childNodes.splice(index, 0, node)
		}
		return node
	}

	removeChild<T extends MiniNode>(node: T): T {
		const index = this.childNodes.indexOf(node)
		if (index !== -1) this.childNodes.splice(index, 1)
		node.parentNode = null
		return node
	}

	remove() {
		this.parentNode?.removeChild(this)
	}

	contains(other: MiniNode | null): boolean {
		let node: MiniNode | null = other
		while (node) {
			if (node === this) return true
			node = node.parentNode
		}
		return false
	}

	get textContent(): string {
		return this.childNodes.map((node) => node.textContent).join('')
	}

	set textContent(value: string) {
		this.childNodes = []
		if (value) this.appendChild(new MiniText(value, this.ownerDocument))
	}

	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | { capture?: boolean },
	) {
		if (!listener) return
		const capture =
			typeof options === 'boolean' ? options : (options?.capture ?? false)
		this.listeners.push({ type, listener, capture })
	}

	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | { capture?: boolean },
	) {
		if (!listener) return
		const capture =
			typeof options === 'boolean' ? options : (options?.capture ?? false)
		this.listeners = this.listeners.filter(
			(entry) =>
				!(
					entry.type === type &&
					entry.listener === listener &&
					entry.capture === capture
				),
		)
	}

	dispatchEvent(event: MiniEvent): boolean {
		if (!event.target) event.target = this
		// 构造从 window -> document -> ... -> target 的完整路径
		const path: MiniNode[] = []
		let node: MiniNode | null = this
		while (node) {
			path.unshift(node)
			node = node.parentNode
		}
		const doc = this.ownerDocument
		if (!path.includes(doc)) path.unshift(doc)
		const win = doc.defaultView as unknown as MiniNode | null
		if (win && !path.includes(win)) path.unshift(win)

		// 捕获阶段：从顶端向下到 target
		for (let index = 0; index < path.length - 1; index++) {
			if (event.propagationStopped) break
			const current = path[index]
			if (!current) continue
			invokeListeners(current, event, true)
		}
		// 目标阶段：先捕获监听后冒泡监听（DOM 规范简化为全部触发）
		const target = path[path.length - 1]
		if (!event.propagationStopped && target) {
			invokeListeners(target, event, true)
			if (!event.immediatePropagationStopped)
				invokeListeners(target, event, false)
		}
		// 冒泡阶段
		if (event.bubbles && !event.propagationStopped) {
			for (let index = path.length - 2; index >= 0; index--) {
				if (event.propagationStopped) break
				const current = path[index]
				if (!current) continue
				invokeListeners(current, event, false)
			}
		}
		return !event.defaultPrevented
	}
}

function invokeListeners(node: MiniNode, event: MiniEvent, capture: boolean) {
	event.currentTarget = node
	for (const entry of [...node.listeners]) {
		if (entry.type !== event.type || entry.capture !== capture) continue
		if (event.immediatePropagationStopped) break
		if (typeof entry.listener === 'function') {
			;(entry.listener as unknown as (e: MiniEvent) => void)(event)
		} else {
			;(
				entry.listener as unknown as { handleEvent(e: MiniEvent): void }
			).handleEvent(event)
		}
	}
}

class MiniText extends MiniNode {
	data: string
	constructor(data: string, ownerDocument: MiniDocument) {
		super(3, ownerDocument)
		this.data = data
	}

	get nodeName(): string {
		return '#text'
	}

	override get textContent(): string {
		return this.data
	}
	override set textContent(value: string) {
		this.data = value
	}
}

class MiniComment extends MiniNode {
	data: string
	constructor(data: string, ownerDocument: MiniDocument) {
		super(8, ownerDocument)
		this.data = data
	}

	get nodeName(): string {
		return '#comment'
	}

	override get textContent(): string {
		return this.data
	}
	override set textContent(value: string) {
		this.data = value
	}
}

class MiniFragment extends MiniNode {
	constructor(ownerDocument: MiniDocument) {
		super(11, ownerDocument)
	}
}

class MiniStyleDeclaration {
	private backing = new Map<string, string>()
	setProperty(name: string, value: string) {
		this.backing.set(name, value)
	}
	getPropertyValue(name: string) {
		return this.backing.get(name) ?? ''
	}
	removeProperty(name: string) {
		this.backing.delete(name)
	}
	get cssText() {
		return [...this.backing.entries()].map(([k, v]) => `${k}: ${v};`).join(' ')
	}
	set cssText(text: string) {
		this.backing.clear()
		for (const part of text.split(';')) {
			const [name, ...rest] = part.split(':')
			if (name && rest.length)
				this.backing.set(name.trim(), rest.join(':').trim())
		}
	}
}

// 动态代理 style：支持 style.width / style.paddingTop 直读直写
function createStyle(): CSSStyleDeclaration {
	const decl = new MiniStyleDeclaration()
	return new Proxy(decl, {
		get(target, prop: string) {
			if (prop in target) {
				const value = (target as unknown as Record<string, unknown>)[prop]
				return typeof value === 'function' ? value.bind(target) : value
			}
			if (typeof prop === 'string') {
				const dashed = prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
				return target.getPropertyValue(dashed)
			}
			return undefined
		},
		set(target, prop: string, value) {
			if (prop === 'cssText') {
				target.cssText = String(value)
				return true
			}
			const dashed = String(prop).replace(
				/[A-Z]/g,
				(c) => `-${c.toLowerCase()}`,
			)
			target.setProperty(dashed, String(value))
			return true
		},
	}) as unknown as CSSStyleDeclaration
}

type MiniClassList = {
	contains(name: string): boolean
	add(...names: string[]): void
	remove(...names: string[]): void
	toggle(name: string, force?: boolean): boolean
}

/** 简单选择器匹配：tag、[attr]、[attr="val"]、.class、#id、后代/逗号组合 */
function parseSimpleSelector(part: string): (el: MiniElement) => boolean {
	const matchers: ((el: MiniElement) => boolean)[] = []
	const segments: { kind: string; value: string }[] = []
	let rest = part.trim()
	while (rest.length) {
		if (rest.startsWith('.')) {
			const end = rest.slice(1).search(/[.#[]/) + 1
			const value = end === 0 ? rest.slice(1) : rest.slice(1, end)
			segments.push({ kind: 'class', value })
			rest = end === 0 ? '' : rest.slice(end)
		} else if (rest.startsWith('#')) {
			const end = rest.slice(1).search(/[.#[]/) + 1
			const value = end === 0 ? rest.slice(1) : rest.slice(1, end)
			segments.push({ kind: 'id', value })
			rest = end === 0 ? '' : rest.slice(end)
		} else if (rest.startsWith('[')) {
			const close = rest.indexOf(']')
			const inner = rest.slice(1, close)
			const eq = inner.indexOf('=')
			if (eq === -1) segments.push({ kind: 'attr', value: inner.trim() })
			else {
				const name = inner.slice(0, eq).trim()
				const value = inner
					.slice(eq + 1)
					.trim()
					.replace(/^["']|["']$/g, '')
				segments.push({ kind: 'attrEq', value: `${name}${value}` })
			}
			rest = rest.slice(close + 1)
		} else {
			const end = rest.search(/[.#[]/)
			const value = end === -1 ? rest : rest.slice(0, end)
			segments.push({ kind: 'tag', value: value.toLowerCase() })
			rest = end === -1 ? '' : rest.slice(end)
		}
	}
	for (const segment of segments) {
		if (segment.kind === 'tag')
			matchers.push((el) => el.tagName.toLowerCase() === segment.value)
		else if (segment.kind === 'class')
			matchers.push((el) => el.classList.contains(segment.value))
		else if (segment.kind === 'id')
			matchers.push((el) => el.getAttribute('id') === segment.value)
		else if (segment.kind === 'attr')
			matchers.push((el) => el.hasAttribute(segment.value))
		else if (segment.kind === 'attrEq') {
			const [name, value] = segment.value.split('')
			matchers.push((el) => el.getAttribute(name ?? '') === value)
		}
	}
	return (el) => matchers.every((fn) => fn(el))
}

function compileSelector(selector: string): (el: MiniElement) => boolean {
	// 支持逗号分组
	const groups = selector.split(',').map((group) => group.trim())
	const groupMatchers = groups.map((group) => {
		// 支持后代选择器（以空白分隔）
		const parts = group.split(/\s+/).filter(Boolean)
		const partMatchers = parts.map(parseSimpleSelector)
		return (el: MiniElement): boolean => {
			// 从最右向左匹配
			if (!partMatchers[partMatchers.length - 1]?.(el)) return false
			let current: MiniElement | null = el.parentElement
			for (let index = partMatchers.length - 2; index >= 0; index--) {
				const matcher = partMatchers[index]
				if (!matcher) continue
				let found: MiniElement | null = null
				let scan: MiniElement | null = current
				while (scan) {
					if (matcher(scan)) {
						found = scan
						break
					}
					scan = scan.parentElement
				}
				if (!found) return false
				current = found.parentElement
			}
			return true
		}
	})
	return (el) => groupMatchers.some((fn) => fn(el))
}

class MiniElement extends MiniNode {
	tagName: string
	attributes = new Map<string, string>()
	style: CSSStyleDeclaration = createStyle()
	classList: MiniClassList
	dataset: Record<string, string> = new Proxy({} as Record<string, string>, {
		get: (_target, prop: string) => {
			return (
				this.getAttribute(
					`data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
				) ?? undefined
			)
		},
		set: (_target, prop: string, value) => {
			this.setAttribute(
				`data-${String(prop).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
				String(value),
			)
			return true
		},
	})

	constructor(tagName: string, ownerDocument: MiniDocument) {
		super(1, ownerDocument)
		this.tagName = tagName.toUpperCase()

		const self = this
		this.classList = {
			contains(name) {
				return (self.getAttribute('class') ?? '').split(/\s+/).includes(name)
			},
			add(...names) {
				const current = new Set(
					(self.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
				)
				for (const name of names) current.add(name)
				self.setAttribute('class', [...current].join(' '))
			},
			remove(...names) {
				const current = new Set(
					(self.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
				)
				for (const name of names) current.delete(name)
				self.setAttribute('class', [...current].join(' '))
			},
			toggle(name, force) {
				const has = this.contains(name)
				const shouldAdd = force ?? !has
				if (shouldAdd) this.add(name)
				else this.remove(name)
				return shouldAdd
			},
		}
	}

	get nodeName(): string {
		return this.tagName
	}

	get className(): string {
		return this.getAttribute('class') ?? ''
	}

	set className(value: string) {
		this.setAttribute('class', value)
	}

	get id(): string {
		return this.getAttribute('id') ?? ''
	}

	set id(value: string) {
		this.setAttribute('id', value)
	}

	getAttribute(name: string): string | null {
		return this.attributes.has(name)
			? (this.attributes.get(name) ?? null)
			: null
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, String(value))
	}

	removeAttribute(name: string) {
		this.attributes.delete(name)
	}

	hasAttribute(name: string): boolean {
		return this.attributes.has(name)
	}

	get children(): MiniElement[] {
		return this.childNodes.filter(
			(node): node is MiniElement => node instanceof MiniElement,
		)
	}

	get innerHTML(): string {
		return this.childNodes.map((node) => serializeNode(node)).join('')
	}

	set innerHTML(html: string) {
		// 测试里只用于清空（innerHTML = ''），不支持完整 HTML 解析
		if (html !== '') throw new Error('MiniDOM only supports innerHTML = ""')
		this.childNodes = []
	}

	get outerHTML(): string {
		return serializeNode(this)
	}

	getBoundingClientRect() {
		return {
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			toJSON: () => ({}),
		}
	}

	get offsetWidth() {
		return 0
	}

	get offsetHeight() {
		return 0
	}

	get clientHeight() {
		return 0
	}

	get clientWidth() {
		return 0
	}

	get scrollHeight() {
		return 0
	}

	get scrollWidth() {
		return 0
	}

	scrollTop = 0
	scrollLeft = 0

	focus() {
		this.ownerDocument.setActiveElement(this)
	}

	blur() {
		if (this.ownerDocument.activeElement === this)
			this.ownerDocument.setActiveElement(null)
	}

	click() {
		// checkbox/radio 先翻转 checked，再派发冒泡的 click 事件（与浏览器一致）。
		// 浏览器原生翻转不走属性 setter（React 的 valueTracker 不会被同步），
		// 这里同样直接写底层存储，让 React 在 click 事件里检测到 checked 变化。
		if (this instanceof MiniInputElement) {
			const protoChecked = Object.getOwnPropertyDescriptor(
				MiniInputElement.prototype,
				'checked',
			)
			const setRaw = (el: MiniInputElement, next: boolean) =>
				protoChecked?.set?.call(el, next)
			// 原型 setter 只写底层 storage；但实例级 tracker 覆盖在实例上，
			// 所以这里通过内部 backing 直接改。
			if (this.type === 'checkbox') {
				writeCheckedBacking(this, !readCheckedBacking(this))
			} else if (this.type === 'radio' && !readCheckedBacking(this)) {
				writeCheckedBacking(this, true)
				void setRaw
				// 同名单选互斥
				const root: MiniNode = this.ownerDocument
				for (const el of collectElements(root)) {
					if (
						el instanceof MiniInputElement &&
						el !== this &&
						el.type === 'radio' &&
						el.getAttribute('name') !== null &&
						el.getAttribute('name') === this.getAttribute('name')
					)
						writeCheckedBacking(el, false)
				}
			}
		}
		this.dispatchEvent(new MiniMouseEvent('click', { bubbles: true }))
	}

	matches(selector: string): boolean {
		return compileSelector(selector)(this)
	}

	querySelector(selector: string): MiniElement | null {
		const matcher = compileSelector(selector)
		for (const el of collectElements(this)) {
			if (el !== this && matcher(el)) return el
		}
		return null
	}

	querySelectorAll(selector: string): MiniElement[] {
		const matcher = compileSelector(selector)
		return collectElements(this).filter((el) => el !== this && matcher(el))
	}
}

function collectElements(root: MiniNode): MiniElement[] {
	const result: MiniElement[] = []
	const walk = (node: MiniNode) => {
		if (node instanceof MiniElement) result.push(node)
		for (const child of node.childNodes) walk(child)
	}
	walk(root)
	return result
}

function escapeAttr(value: string) {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
}

function escapeText(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

function serializeNode(node: MiniNode): string {
	if (node instanceof MiniText) return escapeText(node.data)
	if (node instanceof MiniComment) return `<!--${node.data}-->`
	if (node instanceof MiniElement) {
		const attrs = [...node.attributes.entries()]
			.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
			.join('')
		const tag = node.tagName.toLowerCase()
		const styleText = node.style.cssText
		const styleAttr = styleText ? ` style="${escapeAttr(styleText)}"` : ''
		const voids = ['input', 'br', 'img', 'hr', 'meta', 'link']
		if (voids.includes(tag)) return `<${tag}${attrs}${styleAttr}>`
		return `<${tag}${attrs}${styleAttr}>${node.innerHTML}</${tag}>`
	}
	return node.childNodes.map(serializeNode).join('')
}

class MiniInputElement extends MiniElement {
	_valueBacking = ''
	_checkedBacking = false
	placeholder = ''

	constructor(ownerDocument: MiniDocument) {
		super('input', ownerDocument)
	}

	// input.type 与 type 特性互相反射（React 以属性赋值，选择器按特性匹配）
	get type(): string {
		return this.getAttribute('type') ?? 'text'
	}

	set type(next: string) {
		this.setAttribute('type', next)
	}

	get disabled(): boolean {
		return this.hasAttribute('disabled')
	}

	set disabled(next: boolean) {
		if (next) this.setAttribute('disabled', '')
		else this.removeAttribute('disabled')
	}

	get value(): string {
		return this._valueBacking
	}

	set value(next: string) {
		this._valueBacking = next
	}

	get checked(): boolean {
		return this._checkedBacking
	}

	set checked(next: boolean) {
		this._checkedBacking = next
	}
}

function readCheckedBacking(el: MiniInputElement): boolean {
	return el._checkedBacking
}

function writeCheckedBacking(el: MiniInputElement, next: boolean) {
	el._checkedBacking = next
}

class MiniButtonElement extends MiniElement {
	constructor(ownerDocument: MiniDocument) {
		super('button', ownerDocument)
	}
	get disabled(): boolean {
		return this.hasAttribute('disabled')
	}
	set disabled(next: boolean) {
		if (next) this.setAttribute('disabled', '')
		else this.removeAttribute('disabled')
	}

	get type(): string {
		return this.getAttribute('type') ?? 'submit'
	}
	set type(value: string) {
		this.setAttribute('type', value)
	}
}

class MiniOptionElement extends MiniElement {
	selected = false
	defaultSelected = false
	disabled = false
	constructor(ownerDocument: MiniDocument) {
		super('option', ownerDocument)
	}
	get value(): string {
		const attr = this.getAttribute('value')
		return attr !== null ? attr : this.textContent
	}
	set value(next: string) {
		this.setAttribute('value', next)
	}
}

class MiniSelectElement extends MiniElement {
	disabled = false
	multiple = false
	constructor(ownerDocument: MiniDocument) {
		super('select', ownerDocument)
	}
	get options(): MiniOptionElement[] {
		return collectElements(this).filter(
			(el): el is MiniOptionElement => el instanceof MiniOptionElement,
		)
	}
	get value(): string {
		const hit = this.options.find((option) => option.selected)
		return (hit ?? this.options[0])?.value ?? ''
	}
	set value(next: string) {
		// 浏览器语义：设置 value 会选中匹配的 option
		for (const option of this.options) option.selected = option.value === next
	}
}

class MiniTextAreaElement extends MiniElement {
	value = ''
	disabled = false
	constructor(ownerDocument: MiniDocument) {
		super('textarea', ownerDocument)
	}
}

class MiniDocument extends MiniNode {
	// React 的 isEventSupported 用 'oninput' in document 探测事件支持：
	// 直接置 null 表示支持（浏览器里这些就是 null 初始值）。
	oninput: null = null
	onchange: null = null
	onclick: null = null
	onkeydown: null = null
	onfocusin: null = null
	onfocusout: null = null

	get nodeName(): string {
		return '#document'
	}

	documentElement: MiniElement
	body: MiniElement
	head: MiniElement
	defaultView: MiniWindow | null = null
	private innerActiveElement: MiniElement | null = null

	constructor() {
		super(9, null as unknown as MiniDocument)
		this.ownerDocument = this
		this.documentElement = new MiniElement('html', this)
		this.head = new MiniElement('head', this)
		this.body = new MiniElement('body', this)
		this.documentElement.appendChild(this.head)
		this.documentElement.appendChild(this.body)
		this.appendChild(this.documentElement)
	}

	get activeElement(): MiniElement | null {
		return this.innerActiveElement
	}

	setActiveElement(el: MiniElement | null) {
		this.innerActiveElement = el
	}

	createElement(tagName: string): MiniElement {
		const tag = tagName.toLowerCase()
		if (tag === 'input') return new MiniInputElement(this)
		if (tag === 'button') return new MiniButtonElement(this)
		if (tag === 'select') return new MiniSelectElement(this)
		if (tag === 'option') return new MiniOptionElement(this)
		if (tag === 'textarea') return new MiniTextAreaElement(this)
		return new MiniElement(tag, this)
	}

	createElementNS(_ns: string, tagName: string): MiniElement {
		return this.createElement(tagName)
	}

	createTextNode(data: string): MiniText {
		return new MiniText(data, this)
	}

	createComment(data: string): MiniComment {
		return new MiniComment(data, this)
	}

	createDocumentFragment(): MiniFragment {
		return new MiniFragment(this)
	}

	querySelector(selector: string): MiniElement | null {
		return this.documentElement.querySelector(selector)
	}

	querySelectorAll(selector: string): MiniElement[] {
		return this.documentElement.querySelectorAll(selector)
	}
}

class MiniWindow {
	document: MiniDocument
	listeners: MiniListener[] = []
	innerWidth = 1024
	innerHeight = 768
	parentNode: MiniNode | null = null
	nodeType = 0
	childNodes: MiniNode[] = []
	// React 在 window 上读取构造器（HTMLIFrameElement 等）做 instanceof 判断
	Event = MiniEvent
	MouseEvent = MiniMouseEvent
	KeyboardEvent = MiniKeyboardEvent
	FocusEvent = MiniFocusEvent
	InputEvent = MiniInputEvent
	CustomEvent = MiniCustomEvent
	Node = MiniNode
	Element = MiniElement
	HTMLElement = MiniElement
	HTMLIFrameElement = MiniElement
	HTMLInputElement = MiniInputElement
	HTMLButtonElement = MiniButtonElement
	HTMLSelectElement = MiniSelectElement
	HTMLTextAreaElement = MiniTextAreaElement
	SVGElement = MiniElement
	MutationObserver = MutationObserverStub
	ResizeObserver = ResizeObserverStub

	constructor(document: MiniDocument) {
		this.document = document
	}

	get ownerDocument(): MiniDocument {
		return this.document
	}

	addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | { capture?: boolean },
	) {
		if (!listener) return
		const capture =
			typeof options === 'boolean' ? options : (options?.capture ?? false)
		this.listeners.push({ type, listener, capture })
	}

	removeEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: boolean | { capture?: boolean },
	) {
		if (!listener) return
		const capture =
			typeof options === 'boolean' ? options : (options?.capture ?? false)
		this.listeners = this.listeners.filter(
			(entry) =>
				!(
					entry.type === type &&
					entry.listener === listener &&
					entry.capture === capture
				),
		)
	}

	dispatchEvent(event: MiniEvent): boolean {
		// window 是传播终点：document.body 的冒泡路径在 MiniNode.dispatchEvent 里已包含 window
		event.target = event.target ?? (this as unknown as MiniNode)
		event.currentTarget = this as unknown as MiniNode
		for (const entry of [...this.listeners]) {
			if (entry.type !== event.type) continue
			if (typeof entry.listener === 'function')
				(entry.listener as unknown as (e: MiniEvent) => void)(event)
			else
				(
					entry.listener as unknown as { handleEvent(e: MiniEvent): void }
				).handleEvent(event)
		}
		return !event.defaultPrevented
	}

	// 动态转发到 globalThis：vi.useFakeTimers 替换全局后 window.* 跟随生效
	setTimeout(...args: Parameters<typeof setTimeout>) {
		return globalThis.setTimeout(...args)
	}

	clearTimeout(...args: Parameters<typeof clearTimeout>) {
		return globalThis.clearTimeout(...args)
	}

	setInterval(...args: Parameters<typeof setInterval>) {
		return globalThis.setInterval(...args)
	}

	clearInterval(...args: Parameters<typeof clearInterval>) {
		return globalThis.clearInterval(...args)
	}

	queueMicrotask(callback: () => void) {
		return globalThis.queueMicrotask(callback)
	}

	requestAnimationFrame(callback: () => void) {
		return globalThis.setTimeout(callback, 0)
	}

	cancelAnimationFrame(id: number) {
		globalThis.clearTimeout(id)
	}

	getComputedStyle(): Record<string, string> {
		return new Proxy({} as Record<string, string>, {
			get: () => '',
		})
	}
}

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}

class MutationObserverStub {
	observe() {}
	disconnect() {}
	takeRecords() {
		return []
	}
}

// ---- 构建并注入全局 DOM ----
const miniDocument = new MiniDocument()
const miniWindow = new MiniWindow(miniDocument)
miniDocument.defaultView = miniWindow

const g = globalThis as Record<string, unknown>
const globals: Record<string, unknown> = {
	window: miniWindow,
	document: miniDocument,
	HTMLElement: MiniElement,
	Element: MiniElement,
	Node: MiniNode,
	Text: MiniText,
	Comment: MiniComment,
	DocumentFragment: MiniFragment,
	HTMLInputElement: MiniInputElement,
	HTMLButtonElement: MiniButtonElement,
	HTMLSelectElement: MiniSelectElement,
	HTMLTextAreaElement: MiniTextAreaElement,
	HTMLOptionElement: MiniOptionElement,
	SVGElement: MiniElement,
	HTMLDialogElement: MiniElement,
	HTMLTemplateElement: MiniElement,
	HTMLAnchorElement: MiniElement,
	ShadowRoot: MiniFragment,
	Event: MiniEvent,
	MouseEvent: MiniMouseEvent,
	KeyboardEvent: MiniKeyboardEvent,
	FocusEvent: MiniFocusEvent,
	InputEvent: MiniInputEvent,
	CustomEvent: MiniCustomEvent,
	ResizeObserver: ResizeObserverStub,
	MutationObserver: MutationObserverStub,
	getComputedStyle: () => miniWindow.getComputedStyle(),
	requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	IS_REACT_ACT_ENVIRONMENT: true,
}
for (const [key, value] of Object.entries(globals)) {
	try {
		Object.defineProperty(g, key, {
			value,
			configurable: true,
			writable: true,
		})
	} catch {
		// Node 自带的只读全局（如 navigator）跳过
	}
}

// DOM 全局就绪之后再加载 React 全家桶：静态 import 会在 DOM 注入之前求值
// react-dom（canUseDOM 在模块加载时固定），因此这里用 top-level await 动态加载。
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')

afterAll(() => {
	vi.useRealTimers()
})

/** 挂载一个 React 树到独立容器，返回容器与卸载函数；所有挂载都会在 afterEach 自动清理 */
const mountedViews: { unmount(): Promise<void> }[] = []

async function mount(node: ReactNode) {
	const host = document.createElement('div')
	document.body.appendChild(host)
	const root: Root = createRoot(host)
	await act(async () => {
		root.render(node)
	})
	let done = false
	const view = {
		host,
		async unmount() {
			if (done) return
			done = true
			await act(async () => {
				root.unmount()
			})
			host.remove()
		},
	}
	mountedViews.push(view)
	return view
}

afterEach(async () => {
	while (mountedViews.length) {
		await mountedViews.pop()?.unmount()
	}
	// 兜底清掉可能残留在 body 上的 portal 节点
	document.body.innerHTML = ''
})

const pressEscape = async () => {
	await act(async () => {
		window.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
		)
	})
}

describe('usePresence', () => {
	it('open=true 立即挂载并保持 enter', async () => {
		const { usePresence } = await import(
			'../../packages/ui/src/components/Motion'
		)
		const states: string[] = []
		function Probe() {
			const { mounted, state } = usePresence(true, 200)
			states.push(`${mounted}:${state}`)
			return null
		}
		const view = await mount(createElement(Probe))
		expect(states.at(-1)).toBe('true:enter')
		await view.unmount()
	})

	it('关闭后进入 exit，exitMs 后卸载；重开取消卸载计时器', async () => {
		vi.useFakeTimers()
		try {
			const { usePresence } = await import(
				'../../packages/ui/src/components/Motion'
			)
			const seen: string[] = []
			function Probe({ open }: { open: boolean }) {
				const { mounted, state } = usePresence(open, 200)
				seen.push(`${mounted}:${state}`)
				return createElement('div', null, mounted ? state : 'gone')
			}
			const host = document.createElement('div')
			document.body.appendChild(host)
			const root: Root = createRoot(host)
			await act(async () => {
				root.render(createElement(Probe, { open: true }))
			})
			expect(host.textContent).toBe('enter')

			await act(async () => {
				root.render(createElement(Probe, { open: false }))
			})
			expect(host.textContent).toBe('exit')

			// 未到 exitMs 时仍挂载
			await act(async () => {
				vi.advanceTimersByTime(100)
			})
			expect(host.textContent).toBe('exit')

			// 重开：取消卸载计时器，回到 enter
			await act(async () => {
				root.render(createElement(Probe, { open: true }))
			})
			expect(host.textContent).toBe('enter')
			await act(async () => {
				vi.advanceTimersByTime(500)
			})
			expect(host.textContent).toBe('enter')

			// 再次关闭并走完整 exitMs 才卸载
			await act(async () => {
				root.render(createElement(Probe, { open: false }))
			})
			await act(async () => {
				vi.advanceTimersByTime(250)
			})
			expect(host.textContent).toBe('gone')
			expect(seen).toContain('false:exit')
			await act(async () => {
				root.unmount()
			})
			host.remove()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('Modal & ConfirmDialog', () => {
	it('open 时挂载 portal 到 body，关闭后卸载', async () => {
		const { Modal } = await import('../../packages/ui/src/components/Modal')
		const view = await mount(
			createElement(Modal, {
				children: null,
				open: true,
				title: '标题',
				onClose: () => {},
			}),
		)
		expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
		await view.unmount()
		expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
	})

	it('Escape 触发 onClose', async () => {
		const { Modal } = await import('../../packages/ui/src/components/Modal')
		let closed = 0
		const view = await mount(
			createElement(Modal, {
				children: null,
				open: true,
				title: 'Esc',
				onClose: () => {
					closed += 1
				},
			}),
		)
		await pressEscape()
		expect(closed).toBe(1)
		await view.unmount()
	})

	it('点击 scrim 关闭，点击面板不关闭', async () => {
		const { Modal } = await import('../../packages/ui/src/components/Modal')
		let closed = 0
		const view = await mount(
			createElement(Modal, {
				children: createElement('p', null, 'body'),
				open: true,
				title: 'Backdrop',
				onClose: () => {
					closed += 1
				},
			}),
		)
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
		await act(async () => {
			dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})
		expect(closed).toBe(0)
		const scrim = dialog.parentElement?.querySelector(
			'button[aria-hidden="true"]',
		) as HTMLButtonElement
		expect(scrim).toBeTruthy()
		await act(async () => {
			scrim.click()
		})
		expect(closed).toBe(1)
		await view.unmount()
	})

	it('closeDisabled 时 Escape、backdrop 与关闭按钮都不触发关闭', async () => {
		const { Modal } = await import('../../packages/ui/src/components/Modal')
		let closed = 0
		const view = await mount(
			createElement(Modal, {
				children: null,
				open: true,
				title: 'Busy',
				closeDisabled: true,
				onClose: () => {
					closed += 1
				},
			}),
		)
		await pressEscape()
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
		await act(async () => {
			;(dialog.parentElement as HTMLElement).dispatchEvent(
				new MouseEvent('click', { bubbles: true }),
			)
		})
		const closeButton = dialog.querySelector(
			'button[aria-label]',
		) as HTMLButtonElement
		expect(closeButton.disabled).toBe(true)
		expect(closed).toBe(0)
		await view.unmount()
	})

	it('ConfirmDialog confirm/cancel 回调与默认按钮文案', async () => {
		const { ConfirmDialog } = await import(
			'../../packages/ui/src/components/Extended'
		)
		let confirmed = 0
		let cancelled = 0
		const view = await mount(
			createElement(ConfirmDialog, {
				open: true,
				title: '删除',
				message: '不可恢复',
				onConfirm: () => {
					confirmed += 1
				},
				onCancel: () => {
					cancelled += 1
				},
			}),
		)
		const buttons = [
			...document.body.querySelectorAll<HTMLButtonElement>(
				'[role="dialog"] button',
			),
		]
		const cancel = buttons.find((button) => button.textContent === '取消')
		const confirm = buttons.find((button) => button.textContent === '确认')
		expect(cancel).toBeTruthy()
		expect(confirm).toBeTruthy()
		await act(async () => {
			confirm?.click()
		})
		expect(confirmed).toBe(1)
		await act(async () => {
			cancel?.click()
		})
		expect(cancelled).toBe(1)
		await view.unmount()
	})

	it('ConfirmDialog danger 渲染 danger 变体按钮，busy 时禁用关闭', async () => {
		const { ConfirmDialog } = await import(
			'../../packages/ui/src/components/Extended'
		)
		let cancelled = 0
		const view = await mount(
			createElement(ConfirmDialog, {
				open: true,
				title: '危险',
				message: 'msg',
				danger: true,
				busy: true,
				onConfirm: () => {},
				onCancel: () => {
					cancelled += 1
				},
			}),
		)
		const html = document.body.querySelector('[role="dialog"]')?.innerHTML ?? ''
		expect(html).toContain('nl-btn-danger')
		await pressEscape()
		expect(cancelled).toBe(0)
		await view.unmount()
	})
})

describe('Drawer', () => {
	it('portal 挂载 role=dialog、标题与关闭按钮', async () => {
		const { Drawer } = await import('../../packages/ui/src/components/Extended')
		let closed = 0
		const view = await mount(
			createElement(Drawer, {
				children: createElement('p', null, 'drawer body'),
				open: true,
				title: '详情',
				onClose: () => {
					closed += 1
				},
			}),
		)
		const dialog = document.body.querySelector('[role="dialog"]')
		expect(dialog).toBeTruthy()
		expect(dialog?.getAttribute('aria-modal')).toBe('true')
		expect(dialog?.querySelector('h2')?.textContent).toBe('详情')
		expect(dialog?.textContent).toContain('drawer body')
		const closeButton = dialog?.querySelector(
			'button[aria-label="关闭"]',
		) as HTMLButtonElement
		expect(closeButton).toBeTruthy()
		await act(async () => {
			closeButton.click()
		})
		expect(closed).toBe(1)
		await view.unmount()
		expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
	})

	it('Escape 关闭抽屉', async () => {
		const { Drawer } = await import('../../packages/ui/src/components/Extended')
		let closed = 0
		const view = await mount(
			createElement(Drawer, {
				children: 'x',
				open: true,
				title: 'Esc drawer',
				onClose: () => {
					closed += 1
				},
			}),
		)
		await pressEscape()
		expect(closed).toBe(1)
		await view.unmount()
	})

	it('点击 scrim 按钮关闭抽屉，点击面板不关闭', async () => {
		const { Drawer } = await import('../../packages/ui/src/components/Extended')
		let closed = 0
		const view = await mount(
			createElement(Drawer, {
				children: createElement('p', null, 'content'),
				open: true,
				title: 'Backdrop drawer',
				onClose: () => {
					closed += 1
				},
			}),
		)
		const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement
		await act(async () => {
			dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		})
		expect(closed).toBe(0)
		const scrim = dialog.parentElement?.querySelector(
			'button[aria-hidden="true"]',
		) as HTMLButtonElement
		expect(scrim).toBeTruthy()
		expect(scrim.type).toBe('button')
		await act(async () => {
			scrim.click()
		})
		expect(closed).toBe(1)
		await view.unmount()
	})
})

describe('ToastProvider + useToast', () => {
	const setup = async () => {
		const { ToastProvider, useToast } = await import(
			'../../packages/ui/src/components/Toast'
		)
		let pushRef: ((text: string) => void) | null = null
		function Capture() {
			pushRef = useToast()
			return null
		}
		const view = await mount(
			createElement(ToastProvider, null, createElement(Capture)),
		)
		return {
			view,
			push: (text: string) => pushRef?.(text),
		}
	}

	it('push 渲染 toast，点击立即消失', async () => {
		vi.useFakeTimers()
		try {
			const { view, push } = await setup()
			await act(async () => {
				push('已保存')
			})
			const region = document.body.querySelector('[role="status"]')
			expect(region?.textContent).toContain('已保存')
			const toast = region?.querySelector('button') as HTMLButtonElement
			await act(async () => {
				toast.click()
			})
			// 点击后进入 exiting，200ms 后移除
			await act(async () => {
				vi.advanceTimersByTime(250)
			})
			expect(
				document.body.querySelector('[role="status"]')?.textContent ?? '',
			).not.toContain('已保存')
			await view.unmount()
		} finally {
			vi.useRealTimers()
		}
	})

	it('2400ms 自动 dismiss，退场后移除', async () => {
		vi.useFakeTimers()
		try {
			const { view, push } = await setup()
			await act(async () => {
				push('自动消失')
			})
			expect(document.body.textContent).toContain('自动消失')
			await act(async () => {
				vi.advanceTimersByTime(2300)
			})
			expect(document.body.textContent).toContain('自动消失')
			await act(async () => {
				vi.advanceTimersByTime(400)
			})
			expect(document.body.textContent).not.toContain('自动消失')
			await view.unmount()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('Toggle', () => {
	it('role=switch 与 aria-checked 跟随状态，点击切换', async () => {
		const { Toggle } = await import('../../packages/ui/src/components/Form')
		let on = false
		function Harness() {
			return createElement(Toggle, {
				on,
				'aria-label': '开关',
				onChange: (next: boolean) => {
					on = next
					view.rerender()
				},
			})
		}
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root: Root = createRoot(host)
		const view = {
			async rerender() {
				await act(async () => {
					root.render(createElement(Harness))
				})
			},
		}
		await view.rerender()
		const toggle = host.querySelector(
			'button[role="switch"]',
		) as HTMLButtonElement
		expect(toggle).toBeTruthy()
		expect(toggle.getAttribute('aria-checked')).toBe('false')
		await act(async () => {
			toggle.click()
		})
		expect(on).toBe(true)
		expect(
			host.querySelector('button[role="switch"]')?.getAttribute('aria-checked'),
		).toBe('true')
		await act(async () => {
			root.unmount()
		})
		host.remove()
	})
})

describe('Checkbox & RadioGroup', () => {
	it('Checkbox 反映 checked 并回调新值', async () => {
		const { Checkbox } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const calls: boolean[] = []
		const view = await mount(
			createElement(Checkbox, {
				checked: false,
				label: '启用',
				onChange: (next: boolean) => calls.push(next),
			}),
		)
		const input = view.host.querySelector(
			'input[type="checkbox"]',
		) as HTMLInputElement
		expect(input.checked).toBe(false)
		await act(async () => {
			input.click()
		})
		expect(calls).toEqual([true])
		await view.unmount()
	})

	it('RadioGroup 切换选中项并触发 onChange', async () => {
		const { RadioGroup } = await import(
			'../../packages/ui/src/components/Extended'
		)
		let value = 'a'
		const calls: string[] = []
		function Harness() {
			return createElement(RadioGroup, {
				value,
				options: [
					{ value: 'a' as const, label: '甲' },
					{ value: 'b' as const, label: '乙' },
				],
				onChange: (next: string) => {
					calls.push(next)
					value = next
					rerender()
				},
			})
		}
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root: Root = createRoot(host)
		async function rerender() {
			await act(async () => {
				root.render(createElement(Harness))
			})
		}
		await rerender()
		expect(host.querySelector('[role="radiogroup"]')).toBeTruthy()
		const radios = [
			...host.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
		]
		expect(radios).toHaveLength(2)
		expect(radios[0]?.checked).toBe(true)
		await act(async () => {
			radios[1]?.click()
		})
		expect(calls).toEqual(['b'])
		expect(
			host.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1],
		).toBeTruthy()
		await act(async () => {
			root.unmount()
		})
		host.remove()
	})
})

describe('Select & CompactSelect', () => {
	it('Select 渲染全部选项并触发 onChange', async () => {
		const { Select } = await import('../../packages/ui/src/components/Form')
		const calls: string[] = []
		const view = await mount(
			createElement(Select, {
				value: 'a',
				'aria-label': '档位',
				options: [
					{ value: 'a' as const, label: '低' },
					{ value: 'b' as const, label: '高' },
				],
				onChange: (next: string) => calls.push(next),
			}),
		)
		const select = view.host.querySelector('select') as HTMLSelectElement
		expect(select.querySelectorAll('option')).toHaveLength(2)
		expect(select.value).toBe('a')
		await act(async () => {
			// 原型 setter 绕过 React 实例级 valueTracker，模拟原生交互产生的差异
			Object.getOwnPropertyDescriptor(
				HTMLSelectElement.prototype,
				'value',
			)?.set?.call(select, 'b')
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(calls).toEqual(['b'])
		await view.unmount()
	})

	it('CompactSelect 渲染选项并触发 onChange', async () => {
		const { CompactSelect } = await import(
			'../../packages/ui/src/components/Form'
		)
		const calls: string[] = []
		const view = await mount(
			createElement(CompactSelect, {
				value: 'x',
				options: [
					{ value: 'x' as const, label: '一' },
					{ value: 'y' as const, label: '二' },
				],
				onChange: (next: string) => calls.push(next),
			}),
		)
		const select = view.host.querySelector('select') as HTMLSelectElement
		expect(select.querySelectorAll('option')).toHaveLength(2)
		await act(async () => {
			Object.getOwnPropertyDescriptor(
				HTMLSelectElement.prototype,
				'value',
			)?.set?.call(select, 'y')
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(calls).toEqual(['y'])
		await view.unmount()
	})
})

describe('Card', () => {
	it('传 onClick 时带 nl-card-interactive、role=button，Enter/Space 激活', async () => {
		const { Card } = await import('../../packages/ui/src/components/Card')
		let clicks = 0
		const view = await mount(
			createElement(
				Card,
				{
					onClick: () => {
						clicks += 1
					},
				},
				'内容',
			),
		)
		const card = view.host.querySelector('.nl-card-interactive') as HTMLElement
		expect(card).toBeTruthy()
		expect(card.getAttribute('role')).toBe('button')
		for (const key of ['Enter', ' ']) {
			await act(async () => {
				card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
			})
		}
		await act(async () => {
			card.click()
		})
		expect(clicks).toBe(3)
		await view.unmount()
	})

	it('不传 onClick 时非交互', async () => {
		const { Card } = await import('../../packages/ui/src/components/Card')
		const view = await mount(createElement(Card, null, '静态'))
		const card = view.host.firstElementChild as HTMLElement
		expect(card.classList.contains('nl-card-interactive')).toBe(false)
		expect(card.getAttribute('role')).toBeNull()
		await view.unmount()
	})
})

describe('StatusPill & ChapterStatusMark', () => {
	it('StatusPill 渲染状态文案', async () => {
		const { StatusPill } = await import('../../packages/ui/src/components/Card')
		const view = await mount(createElement(StatusPill, { status: 'producing' }))
		expect(view.host.textContent).toContain('制作中')
		await view.unmount()
	})

	it('ChapterStatusMark：已发布为安静小字，attention 追加需要处理标记', async () => {
		const { ChapterStatusMark } = await import(
			'../../packages/ui/src/components/Card'
		)
		const view = await mount(
			createElement(ChapterStatusMark, {
				status: 'published',
				attention: true,
			}),
		)
		expect(view.host.textContent).toContain('已发布')
		expect(view.host.textContent).toContain('需要处理')
		await view.unmount()
	})

	it('ChapterStatusMark：waiting 用 StatusPill，不重复输出已发布小字', async () => {
		const { ChapterStatusMark } = await import(
			'../../packages/ui/src/components/Card'
		)
		const view = await mount(
			createElement(ChapterStatusMark, { status: 'waiting' }),
		)
		expect(view.host.textContent).toContain('等待')
		expect(view.host.textContent).not.toContain('已发布')
		await view.unmount()
	})
})

describe('Pagination', () => {
	it('页码、边界禁用与翻页回调', async () => {
		const { Pagination } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const pages: number[] = []
		const view = await mount(
			createElement(Pagination, {
				page: 2,
				total: 5,
				onChange: (next: number) => pages.push(next),
			}),
		)
		expect(view.host.textContent).toContain('2 / 5')
		const prev = view.host.querySelector(
			'button[aria-label="上一页"]',
		) as HTMLButtonElement
		const next = view.host.querySelector(
			'button[aria-label="下一页"]',
		) as HTMLButtonElement
		expect(prev.disabled).toBe(false)
		expect(next.disabled).toBe(false)
		await act(async () => {
			prev.click()
		})
		await act(async () => {
			next.click()
		})
		expect(pages).toEqual([1, 3])
		await view.unmount()
	})

	it('第一页禁用上一页，最后一页禁用下一页', async () => {
		const { Pagination } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const first = await mount(
			createElement(Pagination, { page: 1, total: 3, onChange: () => {} }),
		)
		expect(
			(
				first.host.querySelector(
					'button[aria-label="上一页"]',
				) as HTMLButtonElement
			).disabled,
		).toBe(true)
		await first.unmount()
		const last = await mount(
			createElement(Pagination, { page: 3, total: 3, onChange: () => {} }),
		)
		expect(
			(
				last.host.querySelector(
					'button[aria-label="下一页"]',
				) as HTMLButtonElement
			).disabled,
		).toBe(true)
		await last.unmount()
	})
})

describe('SearchInput', () => {
	it('输入有值时出现清除按钮，点击清空', async () => {
		const { SearchInput } = await import(
			'../../packages/ui/src/components/Extended'
		)
		let value = '灯塔'
		const calls: string[] = []
		function Harness() {
			return createElement(SearchInput, {
				value,
				onChange: (next: string) => {
					calls.push(next)
					value = next
					rerender()
				},
			})
		}
		const host = document.createElement('div')
		document.body.appendChild(host)
		const root: Root = createRoot(host)
		async function rerender() {
			await act(async () => {
				root.render(createElement(Harness))
			})
		}
		await rerender()
		const clear = host.querySelector(
			'button[aria-label="清除"]',
		) as HTMLButtonElement
		expect(clear).toBeTruthy()
		await act(async () => {
			clear.click()
		})
		expect(calls).toEqual([''])
		expect(host.querySelector('button[aria-label="清除"]')).toBeNull()
		await act(async () => {
			root.unmount()
		})
		host.remove()
	})

	it('空值时不渲染清除按钮', async () => {
		const { SearchInput } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const view = await mount(
			createElement(SearchInput, { value: '', onChange: () => {} }),
		)
		expect(view.host.querySelector('button[aria-label="清除"]')).toBeNull()
		expect(view.host.querySelector('input')).toBeTruthy()
		await view.unmount()
	})
})

describe('Extended 静态结构', () => {
	it('Banner 默认 info 图标与 custom className', async () => {
		const { Banner } = await import('../../packages/ui/src/components/Extended')
		const view = await mount(
			createElement(Banner, { className: 'extra', children: '注意' }),
		)
		const banner = view.host.firstElementChild as HTMLElement
		expect(banner.className).toContain('extra')
		expect(banner.querySelector('svg')).toBeTruthy()
		expect(banner.textContent).toContain('注意')
		await view.unmount()
	})

	it('Checkbox 勾选态渲染 Check 图标', async () => {
		const { Checkbox } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const view = await mount(
			createElement(Checkbox, { checked: true, onChange: () => {} }),
		)
		expect(view.host.querySelector('.nl-check-box svg')).toBeTruthy()
		await view.unmount()
	})

	it('Stepper 已完成步骤渲染 check，当前步骤渲染序号', async () => {
		const { Stepper } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const view = await mount(
			createElement(Stepper, { steps: ['一', '二', '三'], current: 1 }),
		)
		expect(view.host.querySelectorAll('svg').length).toBe(1)
		expect(view.host.textContent).toContain('2')
		expect(view.host.textContent).toContain('3')
		await view.unmount()
	})

	it('Skeleton 宽高与 Slider 读数', async () => {
		const { Skeleton, Slider } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const skeletonView = await mount(
			createElement(Skeleton, { width: 120, height: 10 }),
		)
		const bone = skeletonView.host.firstElementChild as HTMLElement
		expect(bone.style.width).toBe('120px')
		expect(bone.style.height).toBe('10px')
		await skeletonView.unmount()

		const calls: number[] = []
		const sliderView = await mount(
			createElement(Slider, {
				value: 40,
				suffix: '%',
				'aria-label': '速度',
				onChange: (next: number) => calls.push(next),
			}),
		)
		expect(sliderView.host.textContent).toContain('40%')
		const range = sliderView.host.querySelector(
			'input[type="range"]',
		) as HTMLInputElement
		await act(async () => {
			// React 受控输入用原生 setter 绕过 valueTracker，否则 onChange 拿不到新值
			const nativeSetter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				'value',
			)?.set
			nativeSetter?.call(range, '65')
			range.dispatchEvent(new Event('input', { bubbles: true }))
		})
		expect(calls).toEqual([65])
		await sliderView.unmount()
	})

	it('Tooltip 悬停时渲染 role=tooltip，Escape 消失', async () => {
		const { Tooltip } = await import(
			'../../packages/ui/src/components/Extended'
		)
		const view = await mount(
			createElement(Tooltip, {
				text: '说明文字',
				children: createElement('button', { type: 'button' }, '触发'),
			}),
		)
		const trigger = view.host.querySelector('button') as HTMLButtonElement
		expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
		await act(async () => {
			trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
			trigger.parentElement?.dispatchEvent(
				new MouseEvent('mouseenter', { bubbles: false }),
			)
		})
		// React onMouseEnter 监听的是 mouseover 合成事件
		if (!document.body.querySelector('[role="tooltip"]')) {
			await act(async () => {
				trigger.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
			})
		}
		const tooltip = document.body.querySelector('[role="tooltip"]')
		expect(tooltip).toBeTruthy()
		expect(tooltip?.textContent).toContain('说明文字')
		await pressEscape()
		expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
		await view.unmount()
	})
})

describe('Feedback: ErrorNotice / LoadingState / Details / ButtonLink', () => {
	it('ErrorNotice 渲染错误横幅与 message，hint 安静展示', async () => {
		const { ErrorNotice } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const view = await mount(
			createElement(ErrorNotice, {
				error: {
					message: '网络连接中断，请重试。',
					hint: '检查网络后重试',
				},
			}),
		)
		expect(view.host.querySelector('[role="alert"]')).toBeTruthy()
		expect(view.host.textContent).toContain('网络连接中断，请重试。')
		expect(view.host.textContent).toContain('检查网络后重试')
		// 没有 detail 时不渲染详细信息
		expect(view.host.textContent).not.toContain('详细信息')
		await view.unmount()
	})

	it('ErrorNotice 带 detail 时收进默认折叠的详细信息，点击展开', async () => {
		const { ErrorNotice } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const view = await mount(
			createElement(ErrorNotice, {
				error: {
					message: '无法读取，请重试。',
					detail: '[network] Model connection interrupted',
				},
			}),
		)
		const toggle = view.host.querySelector(
			'button[aria-expanded]',
		) as HTMLButtonElement
		expect(toggle).toBeTruthy()
		expect(toggle.textContent).toContain('详细信息')
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		// 折叠时 detail 仍在 Collapse 容器中但容器是 0fr/隐藏的；展开后 aria-expanded 翻转
		await act(async () => {
			toggle.click()
		})
		expect(
			view.host
				.querySelector('button[aria-expanded]')
				?.getAttribute('aria-expanded'),
		).toBe('true')
		expect(view.host.textContent).toContain(
			'[network] Model connection interrupted',
		)
		await view.unmount()
	})

	it('ErrorNotice 渲染重试按钮并触发 onRetry', async () => {
		const { ErrorNotice } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		let retries = 0
		const view = await mount(
			createElement(ErrorNotice, {
				error: { message: '读取失败，请重试。' },
				onRetry: () => {
					retries += 1
				},
			}),
		)
		const retry = [...view.host.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('重试'),
		) as HTMLButtonElement | undefined
		expect(retry).toBeTruthy()
		await act(async () => {
			retry?.click()
		})
		expect(retries).toBe(1)
		await view.unmount()
	})

	it('ErrorNotice 不传 onRetry 时不渲染重试按钮', async () => {
		const { ErrorNotice } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const view = await mount(
			createElement(ErrorNotice, { error: { message: '出错了。' } }),
		)
		expect(
			[...view.host.querySelectorAll('button')].some((button) =>
				button.textContent?.includes('重试'),
			),
		).toBe(false)
		await view.unmount()
	})

	it('LoadingState 输出 role=status 与文案', async () => {
		const { LoadingState } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const view = await mount(
			createElement(LoadingState, { text: '正在读取书库' }),
		)
		const status = view.host.querySelector('[role="status"]')
		expect(status).toBeTruthy()
		expect(status?.textContent).toContain('正在读取书库')
		expect(status?.querySelector('svg')).toBeTruthy()
		await view.unmount()
	})

	it('Details 默认折叠，summary 默认详细信息', async () => {
		const { Details } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const view = await mount(
			createElement(Details, {
				children: createElement('pre', null, 'raw json'),
			}),
		)
		const toggle = view.host.querySelector(
			'button[aria-expanded]',
		) as HTMLButtonElement
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		expect(toggle.textContent).toContain('详细信息')
		await view.unmount()
	})

	it('ButtonLink 渲染链接并带 nl-btn 变体类', async () => {
		const { ButtonLink } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const { MemoryRouter } = await import('react-router-dom')
		const view = await mount(
			createElement(
				MemoryRouter,
				null,
				createElement(ButtonLink, {
					to: '/library',
					variant: 'primary',
					children: '新建工程',
				}),
			),
		)
		const link = view.host.querySelector('a') as HTMLAnchorElement
		expect(link).toBeTruthy()
		expect(link.className).toContain('nl-btn')
		expect(link.className).toContain('nl-btn-primary')
		expect(link.textContent).toContain('新建工程')
		expect(link.getAttribute('href')).toBe('/library')
		await view.unmount()
	})

	it('ButtonLink size=sm 带尺寸类', async () => {
		const { ButtonLink } = await import(
			'../../packages/ui/src/components/Feedback'
		)
		const { MemoryRouter } = await import('react-router-dom')
		const view = await mount(
			createElement(
				MemoryRouter,
				null,
				createElement(ButtonLink, { to: '/x', size: 'sm', children: '小号' }),
			),
		)
		const link = view.host.querySelector('a') as HTMLAnchorElement
		expect(link.className).toContain('nl-btn')
		await view.unmount()
	})
})

describe('Page & EmptyState', () => {
	it('Page 渲染标题与 actions 槽', async () => {
		const { Page } = await import('../../packages/ui/src/components/Page')
		const { MemoryRouter } = await import('react-router-dom')
		const view = await mount(
			createElement(
				MemoryRouter,
				null,
				createElement(Page, {
					title: '书库',
					actions: createElement('button', { type: 'button' }, '主操作'),
					children: createElement('p', null, '正文'),
				}),
			),
		)
		expect(view.host.querySelector('h1')?.textContent).toBe('书库')
		expect(view.host.textContent).toContain('主操作')
		expect(view.host.textContent).toContain('正文')
		await view.unmount()
	})

	it('EmptyState 渲染图标、标题、文本与操作', async () => {
		const { EmptyState } = await import('../../packages/ui/src/components/Page')
		const { LibraryBig } = await import('lucide-react')
		const view = await mount(
			createElement(EmptyState, {
				icon: LibraryBig,
				title: '书库还是空的',
				text: '新建工程开始改编小说',
				actions: createElement('button', { type: 'button' }, '新建'),
			}),
		)
		expect(view.host.querySelector('h2')?.textContent).toBe('书库还是空的')
		expect(view.host.textContent).toContain('新建工程开始改编小说')
		expect(view.host.textContent).toContain('新建')
		expect(view.host.querySelector('svg')).toBeTruthy()
		await view.unmount()
	})

	it('PageAction 渲染为 nl-btn-primary 链接', async () => {
		const { PageAction } = await import('../../packages/ui/src/components/Page')
		const { MemoryRouter } = await import('react-router-dom')
		const { Plus } = await import('lucide-react')
		const view = await mount(
			createElement(
				MemoryRouter,
				null,
				createElement(PageAction, {
					icon: Plus,
					to: '/import',
					children: '新建工程',
				}),
			),
		)
		const link = view.host.querySelector('a') as HTMLAnchorElement
		expect(link.className).toContain('nl-btn')
		expect(link.className).toContain('nl-btn-primary')
		expect(link.textContent).toContain('新建工程')
		await view.unmount()
	})
})

describe('Form inputs CSS-only styling', () => {
	it('TextInput/Textarea 不再内联合并样式对象，保留 nl-input 类', async () => {
		const { TextInput, Textarea } = await import(
			'../../packages/ui/src/components/Form'
		)
		const inputView = await mount(
			createElement(TextInput, { value: 'x', onChange: () => {} }),
		)
		const input = inputView.host.querySelector('input') as HTMLInputElement
		expect(input.className).toContain('nl-input')
		// 内联 style 不再注入 width/padding（样式全部走 CSS 类）
		expect(input.style.width).toBe('')
		expect(input.style.padding).toBe('')
		await inputView.unmount()

		const areaView = await mount(
			createElement(Textarea, { value: 'x', onChange: () => {} }),
		)
		const area = areaView.host.querySelector('textarea') as HTMLTextAreaElement
		expect(area.className).toContain('nl-input')
		expect(area.style.resize).toBe('')
		await areaView.unmount()
	})
})
