// Trial: stable per-line IDs through CodeMirror 6 edits.
// Approach: a StateField holding a RangeSet of line-ID "points" anchored at
// each content line's start position. IDs map through ChangeDesc like
// selections/decorations. The file on disk keeps IDs as trailing `#xxxx`
// markers; in the editor we strip them from the document and keep them in the
// field, so the ID cannot be edited as text.
//
// Runs in pure Node (@codemirror/state only).

import {EditorState, StateField, StateEffect, RangeSet, RangeValue} from "@codemirror/state"
import {Text} from "@codemirror/state"

// ---------- ID value ----------
class LineID extends RangeValue {
  constructor(id) { super(); this.id = id }
  eq(o) { return o instanceof LineID && o.id === this.id }
  toString() { return `#${this.id}` }
}
// Point ranges map through changes; assoc controls which side of an
// insertion the point sticks to. We want the ID to belong to the line it
// started on: insertions at line start (a new line pasted before it) should
// NOT steal the ID → use assoc=1 (point moves to after inserted text)…
// but a newline inserted *inside* the line splits it: the ID must stay with
// the head part. Point at line start + assoc=1 gives exactly that.
LineID.prototype.startSide = 1
LineID.prototype.endSide = 1
LineID.prototype.point = true
LineID.prototype.mapMode = 1 /* MapMode.TrackDel: deleted range → null */

// Parse script text of the form `... #a3f9` into doc text + id ranges.
function parseScript(src) {
  let doc = "", ranges = [], idByLine = []
  let pos = 0
  for (let rawLine of src.split("\n")) {
    let m = / #([0-9a-z]{4})$/.exec(rawLine)
    let text = m ? rawLine.slice(0, m.index) : rawLine
    if (doc.length) doc += "\n"
    let lineStart = doc.length
    doc += text
    let id = m ? m[1] : null
    idByLine.push(id)
    if (id) ranges.push({from: lineStart, id})
    pos += rawLine.length + 1
  }
  return {doc, ranges, idByLine}
}

const setIDs = Symbol("setIDs") // annotation name for tests

const seedIDs = StateEffect.define()

const idField = StateField.define({
  create() { return RangeSet.empty },
  update(set, tr) {
    // First map existing points through the change.
    set = set.map(tr.changes)
    for (let e of tr.effects) if (e.is(seedIDs)) {
      set = RangeSet.of(e.value.map(r => ({from: r.from, to: r.from,
        value: new LineID(r.id)})), true)
    }
    if (tr.docChanged && !tr.effects.some(e => e.is(seedIDs))) {
      // Re-anchor every surviving ID to the start of the line its point now
      // sits in (the point may have been pushed mid-line by inserts).
      let items = [], iter = set.iter()
      while (iter.value) {
        let line = tr.state.doc.lineAt(iter.from)
        items.push({lineFrom: line.from, id: iter.value.id})
        iter.next()
      }
      // A line may now host >1 ID (line join): keep the FIRST id (the line
      // whose head was preserved).
      let byLine = new Map()
      for (let it of items) if (!byLine.has(it.lineFrom)) byLine.set(it.lineFrom, it.id)
      set = RangeSet.of([...byLine].map(([pos, id]) => ({
        from: pos, to: pos, value: new LineID(id)
      })), true)
    }
    return set
  }
})

function mkState(src) {
  let parsed = parseScript(src)
  let state = EditorState.create({doc: parsed.doc, extensions: [idField]})
  return state.update({effects: seedIDs.of(parsed.ranges)}).state
}

function idOf(state, lineNo) {
  let line = state.doc.line(lineNo)
  let found = null
  state.field(idField).between(line.from, line.from, (from, to, v) => { found = v.id })
  return found
}

function allIDs(state) {
  let out = [], iter = state.field(idField).iter()
  while (iter.value) { out.push({pos: iter.from, id: iter.value.id}); iter.next() }
  return out
}

let pass = 0, fail = 0
function check(name, cond, detail="") {
  if (cond) { pass++; console.log("  PASS", name) }
  else { fail++; console.log("  FAIL", name, detail) }
}

const SCRIPT = `scene 教室的黄昏
source p0012-p0018

@bg classroom/dusk fade 1.5
@show lin-xiao/uniform/angry left
lin-xiao: {whisper}其实……{/whisper}{wait 0.6}我一直在等你。 #a3f9
lin-xiao (inner): 为什么偏偏是今天。 #b81c
: 窗外的蝉声停了。 #c02d
@caption 七月十四日 傍晚
@shake strong 0.4
lin-xiao as 神秘少女: 你终于来了。 #d77e`

let state = mkState(SCRIPT)

console.log("== baseline ==")
for (let i = 1; i <= state.doc.lines; i++) {
  console.log(`  line ${i}: id=${idOf(state, i)} text=${JSON.stringify(state.doc.line(i).text.slice(0,40))}`)
}
check("6 script lines carry ids", allIDs(state).length === 6)
check("line 6 is a3f9", idOf(state, 6) === "a3f9")

// --- Scenario 1: type inside line 6 (simulate single replace) ---
console.log("== insert text inside line 6 ==")
let line6 = state.doc.line(6)
state = state.update({changes: {from: line6.to - 2, to: line6.to, insert: "你"}}).state
check("a3f9 still on line 6", idOf(state, 6) === "a3f9", JSON.stringify(allIDs(state)))

// --- Scenario 2: split line 6 with Enter (IME-like: split mid-line) ---
console.log("== split line 6 (Enter at middle) ==")
let l6 = state.doc.line(6)
let cutAt = l6.from + Math.floor(l6.length / 2)
state = state.update({changes: {from: cutAt, insert: "\n"}}).state
check("a3f9 stays on the head line", idOf(state, 6) === "a3f9", JSON.stringify(allIDs(state)))
check("new tail line has no id", idOf(state, 7) === null)
// heal: undo the split
state = state.update({changes: {from: cutAt, to: cutAt + 1, insert: ""}}).state
check("after re-join a3f9 on line 6", idOf(state, 6) === "a3f9")

// --- Scenario 3: insert a new line BEFORE line 6 (paste above) ---
console.log("== insert line above line 6 ==")
let l6b = state.doc.line(6)
state = state.update({changes: {from: l6b.from, insert: "@show other/outfit/happy right\n"}}).state
check("a3f9 moved to line 7", idOf(state, 7) === "a3f9", JSON.stringify(allIDs(state)))
check("new line 6 has no id", idOf(state, 6) === null)
// revert
state = state.update({changes: {from: l6b.from, to: l6b.from + "@show other/outfit/happy right\n".length}}).state

// --- Scenario 4: delete a whole line (line 8, c02d) ---
console.log("== delete line 8 (c02d) ==")
let l8 = state.doc.line(8)
state = state.update({changes: {from: l8.from, to: l8.to + 1}}).state
check("c02d gone", allIDs(state).every(r => r.id !== "c02d"))
check("a3f9 still line 6", idOf(state, 6) === "a3f9")
check("count now 5", allIDs(state).length === 5, JSON.stringify(allIDs(state)))

// --- Scenario 5: move a line (cut line 6, paste after line 8) ---
console.log("== move a3f9 line down ==")
let src = `scene t\na #aaaa\nb #bbbb\nc #cccc`
let s2 = mkState(src)
let la = s2.doc.line(2), lc = s2.doc.line(4)
// cut line 2 then insert after line 4 (now shifted): do in one transaction
let textA = s2.doc.sliceString(la.from, la.to + 1)
s2 = s2.update({changes: [
  {from: la.from, to: la.to + 1},
  {from: lc.to, insert: "\n" + textA.replace(/\n$/, "")}
]}).state
check("aaaa now on line 4", idOf(s2, 4) === "aaaa", JSON.stringify(allIDs(s2)))
check("bbbb on line 2", idOf(s2, 2) === "bbbb")
check("cccc on line 3", idOf(s2, 3) === "cccc")

// --- Scenario 6: join two id'd lines (delete newline between them) ---
console.log("== join aaaa+bbbb lines ==")
let s3 = mkState(src)
let nl = s3.doc.line(2).to // newline pos between line2 and line3
s3 = s3.update({changes: {from: nl, to: nl + 1}}).state
// joined line hosts both aaaa (first) and bbbb (second) — keep first
check("joined line keeps aaaa", idOf(s3, 2) === "aaaa", JSON.stringify(allIDs(s3)))
check("bbbb lost (recorded)", allIDs(s3).every(r => r.id !== "bbbb"))

// --- Scenario 7: IME-like composition: replace last char via multi-step
// (composition insert then commit replace). Simulate: insert composing text,
// then replace composing range with final text in the same position.
console.log("== ime-like compose on line end ==")
let s4 = mkState(src)
let lb = s4.doc.line(3)
// step 1: composition inserts pinyin-ish text at end (browser DOM mutation →
// CM produces a transaction)
s4 = s4.update({changes: {from: lb.to, insert: "nihao"}}).state
check("bbbb survives composing insert", idOf(s4, 3) === "bbbb")
// step 2: commit replaces composing range with 你好
let lb2 = s4.doc.line(3)
s4 = s4.update({changes: {from: lb2.to - 5, to: lb2.to, insert: "你好"}}).state
check("bbbb survives commit", idOf(s4, 3) === "bbbb")
check("text ends with 你好", s4.doc.line(3).text.endsWith("你好"))

// --- Scenario 8: whole-doc replace (agent applies accepted rewrite) ---
console.log("== whole-doc replace ==")
let s5 = mkState(src)
// Replace entire doc → all tracked points die. This is expected: whole-doc
// replace must go through the diff path (apply hunks), NOT a raw setDoc.
s5 = s5.update({changes: {from: 0, to: s5.doc.length, insert: "x #zzzz"}}).state
check("whole-doc replace kills all ids (expected)", allIDs(s5).length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
