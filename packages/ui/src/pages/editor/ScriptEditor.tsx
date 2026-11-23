import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { parseScript } from '@novelive/format/script'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { OverlayScrollbar } from '../../components/ScrollArea'

export function ScriptEditor({
	value,
	onChange,
	onLine,
	position,
	insert,
	onUndo,
	readOnly,
}: {
	value: string
	onChange: (value: string) => void
	onLine: (line: number) => void
	position: { line: number; key: number }
	insert: { before: string; after: string; key: number } | undefined
	onUndo: () => void
	readOnly: boolean
}) {
	const host = useRef<HTMLDivElement>(null)
	const view = useRef<EditorView>(null)
	const scroll = useRef<HTMLElement>(null)
	const callbacks = useRef({ onChange, onLine, onUndo })
	const initial = useRef(value)
	const editable = useRef(new Compartment())
	callbacks.current = { onChange, onLine, onUndo }
	useLayoutEffect(() => {
		if (!host.current) return
		const editor = new EditorView({
			parent: host.current,
			state: EditorState.create({
				doc: initial.current,
				extensions: [
					editable.current.of(EditorView.editable.of(true)),
					lineNumbers(),
					EditorView.lineWrapping,
					EditorView.contentAttributes.of({ 'aria-label': 'NVS 剧本' }),
					keymap.of([
						{
							key: 'Mod-z',
							run: () => {
								callbacks.current.onUndo()
								return true
							},
						},
					]),
					EditorView.updateListener.of((update) => {
						if (update.docChanged)
							callbacks.current.onChange(update.state.doc.toString())
						if (update.selectionSet || update.docChanged)
							callbacks.current.onLine(
								update.state.doc.lineAt(update.state.selection.main.head)
									.number,
							)
					}),
				],
			}),
		})
		view.current = editor
		scroll.current = editor.scrollDOM
		editor.scrollDOM.classList.add('nl-scroll-hidden')
		return () => {
			editor.destroy()
			view.current = null
			scroll.current = null
		}
	}, [])
	useEffect(() => {
		view.current?.dispatch({
			effects: editable.current.reconfigure(EditorView.editable.of(!readOnly)),
		})
	}, [readOnly])
	useEffect(() => {
		const editor = view.current
		const normalized = value.replace(/\r\n?/g, '\n')
		if (editor && editor.state.doc.toString() !== normalized)
			editor.dispatch({
				changes: { from: 0, to: editor.state.doc.length, insert: normalized },
				selection: {
					anchor: Math.min(editor.state.selection.main.head, normalized.length),
				},
			})
	}, [value])
	useEffect(() => {
		const editor = view.current
		if (!editor) return
		const line = editor.state.doc.line(
			Math.min(Math.max(position.line, 1), editor.state.doc.lines),
		)
		editor.dispatch({
			selection: { anchor: line.from },
			effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
		})
		editor.focus()
	}, [position])
	useEffect(() => {
		const editor = view.current
		if (!editor || !insert) return
		const selection = editor.state.selection.main
		const line = editor.state.doc.lineAt(selection.head)
		const parsed = parseScript(editor.state.doc.toString())
			.scenes.flatMap((scene) => scene.lines)
			.find((item) => item.line === line.number)
		if (parsed?.type !== 'text') return
		const delimiter =
			parsed.kind === 'caption'
				? parsed.col - 1 + '@caption'.length
				: line.text.indexOf(':', parsed.col - 1) + 1
		const prefix =
			line.text.length - line.text.slice(delimiter).trimStart().length
		const suffix = line.text.search(/(?: cont| wait)? #[0-9a-f]{4}\s*$/)
		if (
			suffix < prefix ||
			editor.state.doc.lineAt(selection.from).number !== line.number
		)
			return
		const from = Math.max(
			line.from + prefix,
			Math.min(selection.from, line.from + suffix),
		)
		const to = Math.max(from, Math.min(selection.to, line.from + suffix))
		const text = editor.state.sliceDoc(from, to)
		editor.dispatch({
			changes: { from, to, insert: insert.before + text + insert.after },
			selection: {
				anchor: from + insert.before.length,
				head: from + insert.before.length + text.length,
			},
		})
		editor.focus()
	}, [insert])
	return (
		<div className="editor-code">
			<div ref={host} />
			<OverlayScrollbar targetRef={scroll} />
		</div>
	)
}
