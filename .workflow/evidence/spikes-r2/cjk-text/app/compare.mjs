import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
// get DOM full-text line breaks (positions of chars at line starts)
const domLines = await p.evaluate(()=>{
  const ghost=[...document.querySelectorAll('#dstable')];
  // instead measure each char span in live (all present, opacity 0)
  const spans=[...document.querySelectorAll('#dlive .c')];
  const lines=[]; let curTop=null, cur=[];
  for(const s of spans){const t=Math.round(s.getBoundingClientRect().top); if(curTop===null||Math.abs(t-curTop)>4){if(cur.length)lines.push(cur);cur=[];curTop=t;}cur.push(s.textContent);}
  if(cur.length)lines.push(cur);
  return lines.map(l=>l.join(''));
});
console.log('DOM lines:',JSON.stringify(domLines));
// now reveal all pixi and get its line breaks via measureText? use metrics
const pixi = await p.evaluate(()=>{
  window.pixiRevealAll();
  return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const t = window.app.stage.children[0];
    r({height:t.height, width:t.width});
  })));
});
console.log('PIXI box:',JSON.stringify(pixi));
// pixi line breaks: use PIXI's measure via TextMetrics? simpler: read internal layout via text object
const pixiLines = await p.evaluate(()=>{
  const PIXI=window.PIXI;
  const m = PIXI.CanvasTextMetrics.measureText(window.TEXT_FULL||'', window.app.stage.children[0].style);
  return {lines:m.lines.length, lineBreaks:m.lineBreaks, linesText:m.lines};
});
console.log('PIXI lines:',JSON.stringify(pixiLines));
await b.close();
