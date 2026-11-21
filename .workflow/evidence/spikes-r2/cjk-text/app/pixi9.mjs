import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
const r = await p.evaluate(()=>{
  return {tf:typeof window.TEXT_FULL, len: window.TEXT_FULL?.length, head: window.TEXT_FULL?.slice(0,15)};
});
console.log(JSON.stringify(r));
await b.close();
