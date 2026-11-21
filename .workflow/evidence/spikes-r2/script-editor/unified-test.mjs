import {chromium} from "playwright"
import {createServer} from "http"
import {readFileSync} from "fs"
const MIME={".html":"text/html",".js":"text/javascript"}
const server=createServer((req,res)=>{const p=req.url==="/"?"/unified.html":req.url
  try{const ext=p.slice(p.lastIndexOf("."));res.setHeader("Content-Type",MIME[ext]||"text/plain");res.end(readFileSync("."+p))}catch{res.statusCode=404;res.end()}}).listen(8932)
const browser=await chromium.launch();const page=await browser.newPage()
page.on("pageerror",e=>console.log("[pageerror]",e.message))
await page.goto("http://localhost:8932/unified.html")
await page.waitForFunction(()=>window.__uni)
console.log("chunks:",await page.evaluate(()=>window.__uni.chunks()))
// accept chunk at first chunk's fromB
let r=await page.evaluate(()=>{let ch=window.__uni.chunks()[0];return window.__uni.acceptAt(ch.fromB)})
console.log("accept@fromB:",r)
console.log("orig after:",JSON.stringify(await page.evaluate(()=>window.__uni.origText())))
await browser.close();server.close()
