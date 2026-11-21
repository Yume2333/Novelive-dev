import {EditorView} from "@codemirror/view"
import {EditorState} from "@codemirror/state"
import {unifiedMergeView, getOriginalDoc, acceptChunk, getChunks} from "@codemirror/merge"
const ORIG=`scene 教室的黄昏
lin-xiao: 我一直在等你。 #a3f9
lin-xiao (inner): 为什么偏偏是今天。 #b81c
: 窗外的蝉声停了。 #c02d
lin-xiao as 神秘少女: 你终于来了。 #d77e`
const NEW=`scene 教室的黄昏
lin-xiao: 我……一直在等你。 #a3f9
lin-xiao (inner): 为什么偏偏是今天。 #b81c
: 窗外的蝉声停了，远处传来电车的轰鸣。 #c02d
su-jiang: 等很久了吧。
lin-xiao as 神秘少女: 你终于来了。 #d77e`
// unifiedMergeView works on the EDITOR's doc (modified); original is the
// "base". Show agent rewrite as the doc being edited, original = current file.
const view=new EditorView({
  state:EditorState.create({doc:NEW,extensions:[unifiedMergeView({original:ORIG,highlightChanges:true,gutter:true})]}),
  parent:document.getElementById("e")
})
window.__uni={
  view,
  chunkCount(){let c=getChunks(view.state);return c?c.chunks.length:0},
  acceptFirst(){return acceptChunk(view)},
  docText(){return view.state.doc.toString()},
  origText(){return getOriginalDoc(view.state).toString()}
}
// expose chunk positions for test
window.__uni.chunks=()=>{let c=getChunks(view.state);return c?c.chunks.map(ch=>({fromA:ch.fromA,toA:ch.toA,fromB:ch.fromB,toB:ch.toB})):[]}
window.__uni.acceptAt=(pos)=>acceptChunk(view,pos)
