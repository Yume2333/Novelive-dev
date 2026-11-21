import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
// DOM ghost lines (kinsoku enforced by line-break:strict)
const dom = await p.evaluate(()=>{
  const spans=[...document.querySelectorAll('#dlive .c')];
  const lines=[];let top=null,cur=[];
  for(const s of spans){const t=Math.round(s.getBoundingClientRect().top);if(top===null||Math.abs(t-top)>4){if(cur.length)lines.push(cur);cur=[];top=t}cur.push(s.textContent)}
  if(cur.length)lines.push(cur);
  return lines.map(l=>l.join(''));
});
console.log('DOM(kinsoku):');
dom.forEach((l,i)=>console.log(' ',i+1,JSON.stringify(l)));
// find bad line starts (。，、」！？…：) in DOM lines
const bad=/^[。，、」』！？：；…—\.\!\?]/;
console.log('DOM bad line starts:',dom.filter(l=>bad.test(l)).length);
await b.close();
