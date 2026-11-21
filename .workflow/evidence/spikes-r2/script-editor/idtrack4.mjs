// v4 FINAL: line-extent ranges [line.from, line.to), head-sticky.
// startSide=1 : insertion at line start pushes range → id stays with moved line
// endSide=1   : insertion at line end is absorbed (typed text joins the line)
// mapMode=TrackDel → dropped iff a deletion covers from==to range entirely
//   (for a point-like empty range only; with from<to, TrackDel drops when the
//   deleted range covers the whole [from,to]) — empirically verified below.
// Re-anchor pass after each doc change: id re-binds to the line containing
// range.from (head wins on split; first-seen wins on join).
import {EditorState, StateField, StateEffect, RangeSet, RangeValue} from "@codemirror/state"

const seedIDs = StateEffect.define()
const assignID = StateEffect.define()   // {from,to,id} for freshly minted ids

class LineID extends RangeValue {
  constructor(id){super();this.id=id}
  eq(o){return o.id===this.id}
  toString(){return `#${this.id}`}
}
LineID.prototype.point = false
LineID.prototype.startSide = 1
LineID.prototype.endSide = 1
LineID.prototype.mapMode = 1 /* TrackDel */

function parseScript(src){
  let doc="",ranges=[]
  for(let raw of src.split("\n")){
    let m=/ #([0-9a-z]{4})$/.exec(raw)
    let text=m?raw.slice(0,m.index):raw
    if(doc.length)doc+="\n"
    let from=doc.length; doc+=text
    if(m)ranges.push({from,to:doc.length,id:m[1]})
  }
  return {doc,ranges}
}

const idField = StateField.define({
  create(){return RangeSet.empty},
  update(set,tr){
    set=set.map(tr.changes)
    let seeded=false
    for(let e of tr.effects){
      if(e.is(seedIDs)){set=RangeSet.of(e.value.map(r=>({from:r.from,to:r.to,value:new LineID(r.id)})),true);seeded=true}
      else if(e.is(assignID)){set=set.update({add:[{from:e.value.from,to:e.value.to,value:new LineID(e.value.id)}]})}
    }
    if(tr.docChanged&&!seeded){
      // Re-anchor: the id belongs to the line its range starts in. If a
      // delete removed the head chars but left tail+newline, the range
      // starts mid-line? No — deletion covering [from,x) of the range moves
      // range start to deletion point; the surviving range still maps to the
      // same logical line head position. LineAt(from) gives the line the
      // surviving text now sits on → correct.
      // Kill condition: a range that collapsed to empty OR whose whole
      // extent was covered was already dropped by TrackDel. Also drop ids
      // whose head line is now EMPTY? Empirical below.
      let items=[],iter=set.iter()
      while(iter.value){
        let l=tr.state.doc.lineAt(iter.from)
        items.push({lineFrom:l.from,wasFrom:iter.from,id:iter.value.id,empty:l.to===l.from})
        iter.next()
      }
      let byLine=new Map()
      for(let it of items){
        let ex=byLine.get(it.lineFrom)
        if(!ex||it.wasFrom<ex.wasFrom)byLine.set(it.lineFrom,it)
      }
      set=RangeSet.of([...byLine.values()].map(it=>({from:it.lineFrom,to:tr.state.doc.lineAt(it.lineFrom).to,value:new LineID(it.id)})),true)
    }
    return set
  }
})

function mkState(src){
  let p=parseScript(src)
  let st=EditorState.create({doc:p.doc,extensions:[idField]})
  return st.update({effects:seedIDs.of(p.ranges)}).state
}
const idOf=(s,n)=>{if(n>s.doc.lines)return null;let l=s.doc.line(n),f=null;s.field(idField).between(l.from,l.to,(a,b,v)=>{if(!f)f=v.id});return f}
const allIDs=s=>{let o=[],it=s.field(idField).iter();while(it.value){o.push({from:it.from,to:it.to,id:it.value.id});it.next()}return o}
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
check("4 ids",allIDs(state).length===4,JSON.stringify(allIDs(state)))
check("a3f9 l6",idOf(state,6)==="a3f9");check("b81c l7",idOf(state,7)==="b81c")
check("c02d l8",idOf(state,8)==="c02d");check("d77e l11",idOf(state,11)==="d77e")

console.log("== type inside line6 ==")
let l6=state.doc.line(6)
state=state.update({changes:{from:l6.to-2,to:l6.to,insert:"你"}}).state
check("a3f9 l6",idOf(state,6)==="a3f9")

console.log("== split line6 mid ==")
l6=state.doc.line(6);let cut=l6.from+(l6.length>>1)
state=state.update({changes:{from:cut,insert:"\n"}}).state
check("a3f9 head l6",idOf(state,6)==="a3f9",JSON.stringify(allIDs(state)))
check("tail l7 no id",idOf(state,7)===null)
state=state.update({changes:{from:cut,to:cut+1}}).state
check("rejoin a3f9 l6",idOf(state,6)==="a3f9")

console.log("== insert line above 6 ==")
l6=state.doc.line(6)
state=state.update({changes:{from:l6.from,insert:"@show x\n"}}).state
check("a3f9 l7",idOf(state,7)==="a3f9",JSON.stringify(allIDs(state)))
check("l6 no id",idOf(state,6)===null)
state=state.update({changes:{from:l6.from,to:l6.from+8}}).state
check("revert a3f9 l6",idOf(state,6)==="a3f9")

console.log("== delete whole line8 c02d incl its newline ==")
let l8=state.doc.line(8)
state=state.update({changes:{from:l8.from,to:l8.to+1}}).state
check("c02d dead",allIDs(state).every(r=>r.id!=="c02d"),JSON.stringify(allIDs(state)))
check("a3f9 l6",idOf(state,6)==="a3f9");check("b81c l7",idOf(state,7)==="b81c")
check("d77e l10 (shifted)",idOf(state,10)==="d77e")
check("3 ids",allIDs(state).length===3)

console.log("== delete via prev-newline span [l7.to, l8.to] ==")
let s2=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let la2=s2.doc.line(2),lb2=s2.doc.line(3)
s2=s2.update({changes:{from:la2.to,to:lb2.to}}).state
check("bbbb dead",allIDs(s2).every(r=>r.id!=="bbbb"),JSON.stringify(allIDs(s2)))
check("aaaa l2",idOf(s2,2)==="aaaa");check("cccc l3",idOf(s2,3)==="cccc")

console.log("== move aaaa below cccc (cut+paste one tr) ==")
let s3=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let la=s3.doc.line(2),lc=s3.doc.line(4)
let t=s3.doc.sliceString(la.from,la.to)
s3=s3.update({changes:[{from:la.from,to:la.to+1},{from:lc.to,insert:"\n"+t}]}).state
check("aaaa l4",idOf(s3,4)==="aaaa",JSON.stringify(allIDs(s3)))
check("bbbb l2",idOf(s3,2)==="bbbb");check("cccc l3",idOf(s3,3)==="cccc")

console.log("== join aaaa+bbbb ==")
let s4=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let nl=s4.doc.line(2).to
s4=s4.update({changes:{from:nl,to:nl+1}}).state
console.log("   ids:",JSON.stringify(allIDs(s4)))
check("joined has an id",idOf(s4,2)!=null)

console.log("== ime compose ==")
let s5=mkState("scene t\na #aaaa\nb #bbbb\nc #cccc")
let lb=s5.doc.line(3)
s5=s5.update({changes:{from:lb.to,insert:"nihao"}}).state
check("bbbb compose",idOf(s5,3)==="bbbb")
let lb5=s5.doc.line(3)
s5=s5.update({changes:{from:lb5.to-5,to:lb5.to,insert:"你好"}}).state
check("bbbb commit",idOf(s5,3)==="bbbb")

console.log("== partial delete head chars ==")
let s6=mkState("scene t\nabcd efgh #aaaa\nb #bbbb")
let lf=s6.doc.line(2)
s6=s6.update({changes:{from:lf.from,to:lf.from+5}}).state
check("aaaa survives partial edit",idOf(s6,2)==="aaaa",JSON.stringify(allIDs(s6)))

console.log("== delete content only, leave empty line ==")
let s7=mkState("scene t\nabcd #aaaa\nb #bbbb")
let lg=s7.doc.line(2)
s7=s7.update({changes:{from:lg.from,to:lg.to}}).state
console.log("   ids:",JSON.stringify(allIDs(s7)),"idOf2:",idOf(s7,2))

console.log("== whole-doc replace ==")
let s8=mkState("scene t\na #aaaa")
s8=s8.update({changes:{from:0,to:s8.doc.length,insert:"x"}}).state
check("all ids dead",allIDs(s8).length===0)

console.log("== assign new id to a line ==")
let s9=mkState("scene t\na\nb #bbbb")
let l2=s9.doc.line(2)
s9=s9.update({effects:assignID.of({from:l2.from,to:l2.to,id:"e5f1"})}).state
check("e5f1 on l2",idOf(s9,2)==="e5f1")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail?1:0)
