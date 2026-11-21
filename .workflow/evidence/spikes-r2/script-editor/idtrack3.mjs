// v3: ID = POINT range at line start, mapMode = TrackBefore.
// Rationale: the ID is owned by the character that began the line (the
// speaker colon, '@', ':', 'l'...).
//  - Delete whole line incl newline: char-after deleted AND char-before
//    (newline) deleted → point dies via TrackBefore... verify empirically.
//  - Insert "\n" above: char-after (line head) survives; point maps with the
//    line; re-anchor pass normalizes to new line start.
//  - Split line at middle: head char survives → id stays on head line.
//  - Join lines (delete newline between L1,L2): L2's head char survives
//    (chars "ab" merge). L1's point is before the deleted newline → dies
//    via TrackBefore; L2's id survives → joined line gets L2's id. Hmm —
//    is that right? If L1's head is at the deletion boundary... empirical.
import {EditorState, StateField, StateEffect, RangeSet, RangeValue} from "@codemirror/state"

const seedIDs = StateEffect.define()
const assignID = StateEffect.define()

class LineID extends RangeValue {
  constructor(id){super();this.id=id}
  eq(o){return o.id===this.id}
  toString(){return `#${this.id}`}
}
LineID.prototype.point = true
LineID.prototype.startSide = 1
LineID.prototype.endSide = 1
LineID.prototype.mapMode = 2 /* TrackBefore: die iff char before point deleted */

function parseScript(src){
  let doc="",ranges=[]
  for (let raw of src.split("\n")){
    let m=/ #([0-9a-z]{4})$/.exec(raw)
    let text=m?raw.slice(0,m.index):raw
    if(doc.length)doc+="\n"
    ranges.push({from:doc.length,id:m?m[1]:null})
    doc+=text
  }
  return {doc,ranges:ranges.filter(r=>r.id)}
}

const idField = StateField.define({
  create(){return RangeSet.empty},
  update(set,tr){
    set=set.map(tr.changes)
    let seeded=false
    for(let e of tr.effects){
      if(e.is(seedIDs)){set=RangeSet.of(e.value.map(r=>({from:r.from,to:r.from,value:new LineID(r.id)})),true);seeded=true}
      else if(e.is(assignID)){set=set.update({add:[{from:e.value.from,to:e.value.from,value:new LineID(e.value.id)}]})}
    }
    if(tr.docChanged&&!seeded){
      // re-anchor each surviving point to its line's start; dedupe per line
      // (first-in-old-doc order wins: smaller original pos)
      let items=[],iter=set.iter()
      while(iter.value){
        let l=tr.state.doc.lineAt(iter.from)
        items.push({lineFrom:l.from,wasFrom:iter.from,id:iter.value.id})
        iter.next()
      }
      let byLine=new Map()
      for(let it of items){let ex=byLine.get(it.lineFrom);if(!ex||it.wasFrom<ex.wasFrom)byLine.set(it.lineFrom,it)}
      set=RangeSet.of([...byLine.values()].map(it=>({from:it.lineFrom,to:it.lineFrom,value:new LineID(it.id)})),true)
    }
    return set
  }
})

function mkState(src){
  let p=parseScript(src)
  let st=EditorState.create({doc:p.doc,extensions:[idField]})
  return st.update({effects:seedIDs.of(p.ranges)}).state
}
const idOf=(s,n)=>{let l=s.doc.line(n),f=null;s.field(idField).between(l.from,l.to,(a,b,v)=>{if(!f)f=v.id});return f}
const allIDs=s=>{let o=[],it=s.field(idField).iter();while(it.value){o.push({pos:it.from,id:it.value.id});it.next()}return o}
let pass=0,fail=0
const check=(n,c,d="")=>c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,d))

const SCRIPT=`scene 教室的黄昏
source p0012-p0018

@bg classroom/dusk fade 1.5
@show lin-xiao/uniform/angry left
lin-xiao: {whisper}其实……{/whisper}{wait 0.6}我一直在等你。 #a3f9
lin-xiao (inner): 为什么偏偏是今天。 #b81c
: 窗外的蝉声停了。 #c02d
@caption 七月十四日 傍晚
@shake strong 0.4
lin-xiao as 神秘少女: 你终于来了。 #d77e`

let state=mkState(SCRIPT)
console.log("== baseline ==")
check("6 ids",allIDs(state).length===6,JSON.stringify(allIDs(state)))
check("line6 a3f9",idOf(state,6)==="a3f9")
check("line11 d77e",idOf(state,11)==="d77e")

console.log("== type inside line 6 ==")
let l6=state.doc.line(6)
state=state.update({changes:{from:l6.to-2,to:l6.to,insert:"你"}}).state
check("a3f9 line6",idOf(state,6)==="a3f9")

console.log("== split line6 mid ==")
l6=state.doc.line(6);let cut=l6.from+(l6.length>>1)
state=state.update({changes:{from:cut,insert:"\n"}}).state
check("a3f9 head line6",idOf(state,6)==="a3f9")
check("tail line7 no id",idOf(state,7)===null)
state=state.update({changes:{from:cut,to:cut+1}}).state
check("rejoin a3f9 line6",idOf(state,6)==="a3f9")

console.log("== insert line above 6 ==")
l6=state.doc.line(6)
state=state.update({changes:{from:l6.from,insert:"@show x\n"}}).state
check("a3f9 line7",idOf(state,7)==="a3f9",JSON.stringify(allIDs(state)))
check("line6 no id",idOf(state,6)===null)
state=state.update({changes:{from:l6.from,to:l6.from+8}}).state

console.log("== delete whole line8 c02d (incl newline) ==")
let l8=state.doc.line(8)
state=state.update({changes:{from:l8.from,to:l8.to+1}}).state
check("c02d gone",allIDs(state).every(r=>r.id!=="c02d"),JSON.stringify(allIDs(state)))
check("a3f9 line6",idOf(state,6)==="a3f9")
check("b81c line7",idOf(state,7)==="b81c")
check("5 ids",allIDs(state).length===5)

console.log("== delete line8 from prev newline (delete [l7.to,l8.to]) ==")
let st2=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let lA2=st2.doc.line(2),lB2=st2.doc.line(3)
st2=st2.update({changes:{from:lA2.to,to:lB2.to}}).state
check("bbbb gone",allIDs(st2).every(r=>r.id!=="bbbb"),JSON.stringify(allIDs(st2)))
check("aaaa line2",idOf(st2,2)==="aaaa")
check("cccc line3",idOf(st2,3)==="cccc")

console.log("== move line aaaa below cccc ==")
let s2=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let la=s2.doc.line(2),lc=s2.doc.line(4)
let t=s2.doc.sliceString(la.from,la.to)
s2=s2.update({changes:[{from:la.from,to:la.to+1},{from:lc.to,insert:"\n"+t}]}).state
check("aaaa line4",idOf(s2,4)==="aaaa",JSON.stringify(allIDs(s2)))
check("bbbb line2",idOf(s2,2)==="bbbb")
check("cccc line3",idOf(s2,3)==="cccc")

console.log("== join aaaa+bbbb (delete newline) ==")
let s3=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let nl=s3.doc.line(2).to
s3=s3.update({changes:{from:nl,to:nl+1}}).state
console.log("   ids:",JSON.stringify(allIDs(s3)))
check("joined line has an id",idOf(s3,2)!=null)

console.log("== ime compose ==")
let s4=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let lb=s4.doc.line(3)
s4=s4.update({changes:{from:lb.to,insert:"nihao"}}).state
check("bbbb compose-insert",idOf(s4,3)==="bbbb")
let lb2=s4.doc.line(3)
s4=s4.update({changes:{from:lb2.to-5,to:lb2.to,insert:"你好"}}).state
check("bbbb commit",idOf(s4,3)==="bbbb")

console.log("== partial delete head of line ==")
let s5=mkState("scene t\nabcd efgh #aaaa\nb #bbbb")
let lf=s5.doc.line(2)
s5=s5.update({changes:{from:lf.from,to:lf.from+5}}).state
check("aaaa survives (head char deleted though!)", idOf(s5,2)==="aaaa",JSON.stringify(allIDs(s5)))

console.log("== delete line content only (leave empty line) ==")
let s6=mkState("scene t\nabcd #aaaa\nb #bbbb")
let lg=s6.doc.line(2)
s6=s6.update({changes:{from:lg.from,to:lg.to}}).state
console.log("   ids:",JSON.stringify(allIDs(s6)),"idOf2:",idOf(s6,2))

console.log("== undo-style: backspace at line3 start merges into line2 ==")
let s7=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let l3=s7.doc.line(3)
s7=s7.update({changes:{from:l3.from-1,to:l3.from}}).state // delete newline before line3
console.log("   ids:",JSON.stringify(allIDs(s7)),"idOf2:",idOf(s7,2))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
