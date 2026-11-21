// Headless verification: line IDs survive real CM6 transactions, IME-like
// composition events, and the merge view renders agent-rewrite hunks.
import {chromium} from "playwright"
import {createServer} from "http"
import {readFileSync} from "fs"

const MIME={".html":"text/html",".js":"text/javascript",".mjs":"text/javascript"}
const server=createServer((req,res)=>{
  const p=req.url==="/"?"/index.html":req.url
  try{const ext=p.slice(p.lastIndexOf("."));res.setHeader("Content-Type",MIME[ext]||"text/plain");res.end(readFileSync("."+p))}catch{res.statusCode=404;res.end()}
}).listen(8931)

const browser=await chromium.launch()
const page=await browser.newPage()
page.on("console",m=>{if(m.type()==="error")console.log("[page-err]",m.text())})
page.on("pageerror",e=>console.log("[pageerror]",e.message))
await page.goto("http://localhost:8931/")
await page.waitForFunction(()=>window.__test)

let pass=0,fail=0
const check=(n,c,d="")=>c?(pass++,console.log("  PASS",n)):(fail++,console.log("  FAIL",n,d))

// baseline: 4 ids
let ids=await page.evaluate(()=>window.__test.ids())
check("4 ids seeded",ids.length===4,JSON.stringify(ids))
check("a3f9 present",ids.some(i=>i.id==="a3f9"))

// 1. real typing: click at end of line 6, type chars
await page.evaluate(()=>{
  let v=window.__test.view, l=v.state.doc.line(6)
  v.dispatch({selection:{anchor:l.to}})
  v.focus()
})
await page.keyboard.type("，真的好累")
check("typed text lands in line6",(await page.evaluate(()=>window.__test.lineText(6))).includes("真的好累"))
check("a3f9 survives typing",await page.evaluate(()=>window.__test.idAtLine(6))==="a3f9")

// 2. real Enter split: cursor mid line7, press Enter
await page.evaluate(()=>{
  let v=window.__test.view,l=v.state.doc.line(7)
  v.dispatch({selection:{anchor:l.from+10}});v.focus()
})
await page.keyboard.press("Enter")
check("split: b81c head line7",await page.evaluate(()=>window.__test.idAtLine(7))==="b81c")
check("split: line8 has no id",await page.evaluate(()=>window.__test.idAtLine(8))===null)
await page.keyboard.press("Backspace") // rejoin
check("rejoin b81c",await page.evaluate(()=>window.__test.idAtLine(7))==="b81c")

// 3. IME-like composition: use CDP to dispatch composition events on the
//    contentDOM. CM reads DOM mutations — insert composing text then commit.
await page.evaluate(async ()=>{
  let v=window.__test.view,l=v.state.doc.line(8)  // narration line c02d
  v.dispatch({selection:{anchor:l.to}});v.focus()
  const el=v.contentDOM
  const sel=window.getSelection();sel.collapse(el,0)
  // fire compositionstart + beforeinput(insertCompositionText) + input
  // browsers (Chromium) translate IME into these; CM listens on DOM mutation.
  el.dispatchEvent(new CompositionEvent("compositionstart",{data:"",bubbles:true}))
  el.dispatchEvent(new InputEvent("beforeinput",{inputType:"insertCompositionText",data:"chansheng",bubbles:true,cancelable:true}))
  // mutate DOM as the IME would: append text node at caret
  document.execCommand("insertText",false,"chansheng")
  el.dispatchEvent(new InputEvent("input",{inputType:"insertCompositionText",data:"chansheng",bubbles:true}))
  // commit: replace composition text
  el.dispatchEvent(new CompositionEvent("compositionend",{data:"蝉声",bubbles:true}))
  el.dispatchEvent(new InputEvent("beforeinput",{inputType:"insertCompositionText",data:"蝉声",bubbles:true}))
})
await page.waitForTimeout(50)
let l8=await page.evaluate(()=>window.__test.lineText(8))
console.log("   line8 now:",JSON.stringify(l8))
check("c02d survives composition",await page.evaluate(()=>window.__test.idAtLine(8))==="c02d",JSON.stringify(await page.evaluate(()=>window.__test.ids())))

// 4. select whole line 9-ish region & delete via keyboard
await page.evaluate(()=>{
  let v=window.__test.view,l=v.state.doc.line(9)  // @caption (no id)
  v.dispatch({selection:{anchor:l.from}});v.focus()
})
await page.keyboard.down("Shift");await page.keyboard.press("End");await page.keyboard.up("Shift")
await page.keyboard.press("Delete")
// line9 merged w/ next; ids should be unaffected for c02d? recount
console.log("   ids after del:",JSON.stringify(await page.evaluate(()=>window.__test.ids())))

// 5. undo restores
await page.evaluate(()=>window.__test.undo())
check("undo restores @caption",(await page.evaluate(()=>window.__test.lineText(9))).startsWith("@caption"))

// 6. merge view opens with chunks
await page.click("#openMerge")
await page.waitForTimeout(150)
let delCount=await page.locator("#mergeWrap .cm-deletedChunk, #mergeWrap .cm-changedLine, #mergeWrap [class*=deleted], #mergeWrap [class*=inserted]").count()
console.log("   merge diff element count:",delCount)
check("merge view rendered chunks",delCount>0)

// 7. line widget chips rendered
let chips=await page.locator("#editor .chip").count()
console.log("   chips:",chips)
check("speaker chips rendered",chips>=3)

// 8. id gutter markers
let gid=await page.locator("#editor .idmark").count()
console.log("   id gutter marks:",gid)
check("id gutter marks",gid===4)

console.log(`\n${pass} passed, ${fail} failed`)
await browser.close();server.close()
process.exit(fail?1:0)
