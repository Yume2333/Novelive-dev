import {EditorView, keymap, lineNumbers, Decoration, WidgetType, ViewPlugin, gutter, GutterMarker} from "@codemirror/view"
import {EditorState, StateField, StateEffect, RangeSet, RangeValue, Prec} from "@codemirror/state"
import {defaultKeymap, history, historyKeymap, undo, redo} from "@codemirror/commands"
import {MergeView, unifiedMergeView, acceptChunk, rejectChunk, getChunks} from "@codemirror/merge"

// ---------- line-ID field (proven algorithm from idtrack5) ----------
const seedIDs = StateEffect.define()
const assignID = StateEffect.define()
class LineID extends RangeValue{constructor(id){super();this.id=id}eq(o){return o.id===this.id}}
LineID.prototype.point=false;LineID.prototype.startSide=1;LineID.prototype.endSide=1;LineID.prototype.mapMode=0

const idField=StateField.define({
  create(){return RangeSet.empty},
  update(set,tr){
    if(tr.docChanged){
      let dels=[]
      tr.changes.iterChanges((fa,ta)=>{if(ta>fa)dels.push([fa,ta])})
      let doomed=[],iter=set.iter(),docLen=tr.startState.doc.length
      while(iter.value){
        let lo=iter.from,hi=Math.min(iter.to+1,docLen),cur=lo,alive=false
        for(let[da,db]of dels){if(da>cur){alive=true;break}if(db>cur)cur=db;if(cur>=hi)break}
        if(cur<hi)alive=true
        if(!alive)doomed.push(iter.value.id)
        iter.next()
      }
      if(doomed.length){let dead=new Set(doomed);set=set.update({filter:(f,t,v)=>!dead.has(v.id)})}
    }
    set=set.map(tr.changes)
    let seeded=false
    for(let e of tr.effects){
      if(e.is(seedIDs)){set=RangeSet.of(e.value.map(r=>({from:r.from,to:r.to,value:new LineID(r.id)})),true);seeded=true}
      else if(e.is(assignID)){set=set.update({add:[{from:e.value.from,to:e.value.to,value:new LineID(e.value.id)}]})}
    }
    if(tr.docChanged&&!seeded){
      let items=[],iter=set.iter()
      while(iter.value){let l=tr.state.doc.lineAt(iter.from);items.push({lineFrom:l.from,wasFrom:iter.from,id:iter.value.id});iter.next()}
      let byLine=new Map()
      for(let it of items){let ex=byLine.get(it.lineFrom);if(!ex||it.wasFrom<ex.wasFrom)byLine.set(it.lineFrom,it)}
      set=RangeSet.of([...byLine.values()].map(it=>{let l=tr.state.doc.lineAt(it.lineFrom);return{from:l.from,to:l.to,value:new LineID(it.id)}}),true)
    }
    return set
  }
})

// ---------- speaker/expression chip as line widget (decoration) ----------
class ChipWidget extends WidgetType{
  constructor(speaker,id){super();this.speaker=speaker;this.id=id}
  eq(o){return o.speaker===this.speaker&&o.id===this.id}
  toDOM(){let s=document.createElement("span");s.className="chip";s.textContent=`${this.speaker}·${this.id||"new"}`;return s}
  ignoreEvent(){return true}
}
// decoration field derived from doc+ids each update: chip at each content line end
const chipDeco=StateField.define({
  create(){return Decoration.none},
  update(deco,tr){
    if(!tr.docChanged&&tr.state===tr.startState)return deco
    let w=[],doc=tr.state.doc
    let ids=new Map(),iter=tr.state.field(idField).iter()
    while(iter.value){ids.set(iter.from,iter.value.id);iter.next()}
    for(let i=1;i<=doc.lines;i++){
      let l=doc.line(i)
      let sp=/^([\w-]+)(?:\s*\(inner\))?(?:\s+as\s+[^:]+)?\s*:/.exec(l.text)
      let tag=/^@(\w+)/.exec(l.text)
      let label=sp?sp[1]:tag?"@"+tag[1]:null
      if(label){
        let id=ids.get(l.from)||null
        w.push(Decoration.widget({widget:new ChipWidget(label,id),side:1}).range(l.to))
      }
    }
    return Decoration.set(w)
  },
  provide:f=>EditorView.decorations.from(f)
})

// ---------- id gutter (shows #id per line, like a line-number side col) ----------
const idGutter=gutter({
  class:"id-gutter",
  lineMarker(view,line){
    let ids=[],iter=view.state.field(idField).iter()
    while(iter.value){if(line.from===iter.from)ids.push(iter.value.id);iter.next()}
    if(!ids.length)return null
    let m=new(class extends GutterMarker{toDOM(){let d=document.createElement("span");d.className="idmark";d.textContent="#"+ids[0];return d}})()
    return m
  }
})

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

function parseScript(src){
  let doc="",ranges=[]
  for(let raw of src.split("\n")){
    let m=/ #([0-9a-z]{4})$/.exec(raw)
    let text=m?raw.slice(0,m.index):raw
    if(doc.length)doc+="\n"
    let from=doc.length;doc+=text
    if(m)ranges.push({from,to:doc.length,id:m[1]})
  }
  return{doc,ranges}
}
let parsed=parseScript(SCRIPT)

const view=new EditorView({
  state:EditorState.create({
    doc:parsed.doc,
    extensions:[lineNumbers(),idGutter,idField,chipDeco,history(),keymap.of([...defaultKeymap,...historyKeymap]),
      EditorView.theme({".cm-line":{"font-family":"'Noto Serif SC',serif","font-size":"15px"}})]
  }),
  parent:document.getElementById("editor")
})
view.dispatch({effects:seedIDs.of(parsed.ranges)})

// ---------- merge view of agent rewrite ----------
const REWRITE=`scene 教室的黄昏
source p0012-p0018

@bg classroom/dusk fade 1.5
@show lin-xiao/uniform/angry left
lin-xiao: {whisper}其实……{/whisper}我……一直在等你。 #a3f9
lin-xiao (inner): 为什么偏偏是今天。 #b81c
: 窗外的蝉声停了，远处传来电车的轰鸣。 #c02d
@caption 七月十四日 傍晚
@shake strong 0.4
@show su-jiang/casual/smile right
lin-xiao as 神秘少女: 你终于来了。 #d77e
su-jiang: 等很久了吧。`

document.getElementById("openMerge").onclick=()=>{
  document.getElementById("mergeWrap").style.display="block"
  if(window._mv)return
  window._mv=new MergeView({
    a:{doc:parsed.doc,extensions:[lineNumbers()]},
    b:{doc:parseScript(REWRITE).doc,extensions:[lineNumbers()]},
    parent:document.getElementById("mergeWrap"),orientation:"a-b",
    revertControls:"a-to-b",highlightChanges:true,collapseUnchanged:{margin:2,minSize:3}
  })
}

// ---------- test hooks ----------
window.__test={
  view, idField, seedIDs, assignID,
  ids(){let o=[],it=view.state.field(idField).iter();while(it.value){o.push({from:it.from,to:it.to,id:it.value.id});it.next()}return o},
  idAtLine(n){let l=view.state.doc.line(n),f=null;view.state.field(idField).between(l.from,l.to,(a,b,v)=>{if(!f)f=v.id});return f},
  dispatch(spec){view.dispatch(spec)},
  docText(){return view.state.doc.toString()},
  lineText(n){return view.state.doc.line(n).text},
  undo(){undo(view)},redo(){redo(view)}
}
