import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
const r = await p.evaluate(()=>{
  const PIXI=window.PIXI;
  const style=window.app.stage.children[0].style;
  const m=PIXI.CanvasTextMetrics.measureText(window.TEXT_FULL, style);
  return {lines:m.lines, breaks:m.lineBreaks, width:m.width, lineWidth:m.lineWidths};
});
console.log(JSON.stringify(r,null,1));
await b.close();
