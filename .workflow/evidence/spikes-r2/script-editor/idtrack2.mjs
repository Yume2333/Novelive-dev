// v2: IDs anchored as NON-point ranges over the line's text extent
// [line.from, line.to] with endSide=-1 / startSide=-1 so an insert at the
// line start pushes the range (ID stays with its line), and TrackDel drops
// the ID only when the change covers the range. After each transaction we
// re-anchor: an ID's range may shrink/split; we keep the ID iff the head of
// the original line survives, then re-normalize it to that line's extent.
import {EditorState, StateField, StateEffect, RangeSet, RangeValue} from "@codemirror/state"

const seedIDs = StateEffect.define()
const assignID = StateEffect.define() // {lineFrom -> id} for newly minted

class LineID extends RangeValue {
  constructor(id) { super(); this.id = id }
  eq(o) { return o.id === this.id }
  toString() { return `#${this.id}` }
}
LineID.prototype.point = false
LineID.prototype.startSide = -1  // insert at from → range stays put (id on old line)
LineID.prototype.endSide = -1    // insert at to   → excluded from range
LineID.prototype.mapMode = 1     // MapMode.TrackDel

function parseScript(src) {
  let doc = "", ranges = []
  for (let rawLine of src.split("\n")) {
    let m = / #([0-9a-z]{4})$/.exec(rawLine)
    let text = m ? rawLine.slice(0, m.index) : rawLine
    if (doc.length) doc += "\n"
    let lineStart = doc.length
    doc += text
    if (m) ranges.push({from: lineStart, to: doc.length, id: m[1]})
  }
  return {doc, ranges}
}

const idField = StateField.define({
  create() { return RangeSet.empty },
  update(set, tr) {
    set = set.map(tr.changes)
    for (let e of tr.effects) if (e.is(seedIDs)) {
      set = RangeSet.of(e.value.map(r => ({from: r.from, to: r.to, value: new LineID(r.id)})), true)
    } else if (e.is(assignID)) {
      // add a fresh id covering its line
      set = set.update({add: [{from: e.value.from, to: e.value.to, value: new LineID(e.value.id)}]})
    }
    if (tr.docChanged && !tr.effects.some(e => e.is(seedIDs))) {
      // Re-anchor: an id range now covers some text; the id belongs to the
      // line where the range STARTS (the head). If the range collapsed to
      // empty or its head line differs, the id is dead (set.map already
      // dropped fully-covered ranges; a range may also have been shortened).
      let items = [], dead = [], iter = set.iter()
      while (iter.value) {
        // head line = line containing iter.from
        let headLine = tr.state.doc.lineAt(iter.from)
        // If the range's start moved off a line start (split: tail kept id?),
        // we want id to stay with the line containing the ORIGINAL head —
        // which is where iter.from still is. Re-anchor to headLine extent.
        items.push({from: headLine.from, to: headLine.to, id: iter.value.id, wasFrom: iter.from})
        iter.next()
      }
      // Multiple ids can land on one line (line join). Keep the one whose
      // original from was earliest-in-old-doc order → first seen wins since
      // iterator walks sorted ranges; ties: prefer the id that started on an
      // earlier position (smaller wasFrom).
      let byLine = new Map()
      for (let it of items) {
        let ex = byLine.get(it.from)
        if (!ex || it.wasFrom < ex.wasFrom) byLine.set(it.from, it)
      }
      set = RangeSet.of([...byLine.values()].map(it => ({
        from: it.from, to: it.to, value: new LineID(it.id)
      })), true)
    }
    return set
  }
})

function mkState(src) {
  let parsed = parseScript(src)
  let st = EditorState.create({doc: parsed.doc, extensions: [idField]})
  return st.update({effects: seedIDs.of(parsed.ranges)}).state
}
function idOf(state, lineNo) {
  let l = state.doc.line(lineNo), found = null
  state.field(idField).between(l.from, l.to, (f, t, v) => { if (!found) found = v.id })
  return found
}
function allIDs(state) {
  let out = [], iter = state.field(idField).iter()
  while (iter.value) { out.push({from: iter.from, to: iter.to, id: iter.value.id}); iter.next() }
  return out
}
let pass = 0, fail = 0
const check = (n, c, d="") => c ? (pass++, console.log("  PASS", n)) : (fail++, console.log("  FAIL", n, d))

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
check("6 ids", allIDs(state).length === 6, JSON.stringify(allIDs(state)))
check("line6 a3f9", idOf(state,6)==="a3f9"); check("line11 d77e", idOf(state,11)==="d77e")

console.log("== type inside line 6 ==")
let l6 = state.doc.line(6)
state = state.update({changes:{from:l6.to-2,to:l6.to,insert:"你"}}).state
check("a3f9 on line6", idOf(state,6)==="a3f9", JSON.stringify(allIDs(state)))

console.log("== split line 6 mid ==")
l6 = state.doc.line(6); let cut = l6.from + (l6.length>>1)
state = state.update({changes:{from:cut,insert:"\n"}}).state
check("a3f9 head line6", idOf(state,6)==="a3f9", JSON.stringify(allIDs(state)))
check("tail line7 no id", idOf(state,7)===null)
state = state.update({changes:{from:cut,to:cut+1}}).state
check("rejoin → a3f9 line6", idOf(state,6)==="a3f9")

console.log("== insert line above 6 ==")
l6 = state.doc.line(6)
state = state.update({changes:{from:l6.from,insert:"@show x\n"}}).state
check("a3f9 now line7", idOf(state,7)==="a3f9", JSON.stringify(allIDs(state)))
check("line6 no id", idOf(state,6)===null)
state = state.update({changes:{from:l6.from,to:l6.from+"@show x\n".length}}).state

console.log("== delete whole line 8 (c02d) ==")
let l8 = state.doc.line(8)
state = state.update({changes:{from:l8.from,to:l8.to+1}}).state
check("c02d gone", allIDs(state).every(r=>r.id!=="c02d"), JSON.stringify(allIDs(state)))
check("a3f9 line6", idOf(state,6)==="a3f9")
check("5 ids", allIDs(state).length===5, JSON.stringify(allIDs(state)))

console.log("== move line ==")
let s2 = mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let la = s2.doc.line(2), lc = s2.doc.line(4)
let t = s2.doc.sliceString(la.from, la.to)
s2 = s2.update({changes:[{from:la.from,to:la.to+1},{from:lc.to,insert:"\n"+t}]}).state
check("aaaa line4", idOf(s2,4)==="aaaa", JSON.stringify(allIDs(s2)))
check("bbbb line2", idOf(s2,2)==="bbbb")
check("cccc line3", idOf(s2,3)==="cccc")

console.log("== join two id lines ==")
let s3 = mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let nl = s3.doc.line(2).to
s3 = s3.update({changes:{from:nl,to:nl+1}}).state
check("joined keeps aaaa", idOf(s3,2)==="aaaa", JSON.stringify(allIDs(s3)))
check("bbbb lost", allIDs(s3).every(r=>r.id!=="bbbb"))

console.log("== ime compose ==")
let s4 = mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let lb = s4.doc.line(3)
s4 = s4.update({changes:{from:lb.to,insert:"nihao"}}).state
check("bbbb survives compose-insert", idOf(s4,3)==="bbbb")
let lb2 = s4.doc.line(3)
s4 = s4.update({changes:{from:lb2.to-5,to:lb2.to,insert:"你好"}}).state
check("bbbb survives commit", idOf(s4,3)==="bbbb")

console.log("== partial line delete (head survives) ==")
let s5 = mkState("scene t\nabcd efgh #aaaa\nb #bbbb")
let lf = s5.doc.line(2)
// delete "abcd " (first 5 chars) → id should stay (line edited, id kept per spec: 内容改了 ID 也不变)
s5 = s5.update({changes:{from:lf.from,to:lf.from+5}}).state
check("aaaa survives partial edit", idOf(s5,2)==="aaaa", JSON.stringify(allIDs(s5)))

console.log("== delete whole line CONTENT but not newline ==")
let s6 = mkState("scene t\nabcd #aaaa\nb #bbbb")
let lg = s6.doc.line(2)
s6 = s6.update({changes:{from:lg.from,to:lg.to}}).state
// empty line left; id range empty→ TrackDel drops it? or stays?
console.log("   ids:", JSON.stringify(allIDs(s6)), "idOf2:", idOf(s6,2))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
