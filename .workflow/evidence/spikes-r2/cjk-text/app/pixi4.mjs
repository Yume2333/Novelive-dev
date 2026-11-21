import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
const r = await p.evaluate(()=>{
  const PIXI=window.PIXI;
  const style=new PIXI.TextStyle({fontFamily:'Noto Serif CJK SC',fontSize:28,fill:0xffffff,wordWrap:true,wordWrapWidth:1690,breakWords:true,lineHeight:53});
  const m=PIXI.CanvasTextMetrics.measureText(window.TEXT_FULL, style, undefined, true);
  return {lines:m.lines.length, ls:m.lines.map(l=>l.slice(0,25)), h:m.height};
});
console.log(JSON.stringify(r,null,1));
await b.close();
