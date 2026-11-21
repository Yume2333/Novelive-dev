import {EditorState,StateField,StateEffect,RangeSet,RangeValue} from "@codemirror/state"
const seed=StateEffect.define()
class V extends RangeValue{constructor(id){super();this.id=id}}
V.prototype.startSide=1;V.prototype.endSide=1
const f=StateField.define({create(){return RangeSet.empty},update(s,tr){
  s=s.map(tr.changes);let seeded=false
  for(let e of tr.effects)if(e.is(seed)){s=RangeSet.of(e.value.map(r=>({from:r.from,to:r.to,value:new V(r.id)})),true);seeded=true}
  if(tr.docChanged&&!seeded){
    let items=[],it=s.iter()
    while(it.value){let l=tr.state.doc.lineAt(it.from);items.push({from:l.from,id:it.value.id});it.next()}
    let m=new Map()
    for(let i of items)if(!m.has(i.from))m.set(i.from,i)
    s=RangeSet.of([...m.values()].map(i=>{let l=tr.state.doc.lineAt(i.from);return{from:l.from,to:l.to,value:new V(i.id)}}),true)
  }
  return s}})
let lines=Array.from({length:2000},(_,i)=>`lin${i}: 句子内容${i}`)
let doc=lines.join("\n")
let st=EditorState.create({doc,extensions:[f]})
let ranges=[],off=0
for(let i=0;i<2000;i+=2){ranges.push({from:off,to:off+lines[i].length,id:"x"+i});off+=lines[i].length+1}
let t0=performance.now()
st=st.update({effects:seed.of(ranges)}).state
console.log("seed 1000 ids:",(performance.now()-t0).toFixed(1),"ms")
t0=performance.now()
st=st.update({changes:{from:0,insert:"new line\n"}}).state
console.log("1-line insert + reanchor:",(performance.now()-t0).toFixed(1),"ms")
t0=performance.now()
for(let i=0;i<50;i++)st=st.update({changes:{from:50+i,insert:"x"}}).state
console.log("50 edits avg:",((performance.now()-t0)/50).toFixed(2),"ms")
