import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
const r = await p.evaluate(async()=>{
  const PIXI=window.PIXI;
  const style=new PIXI.TextStyle({fontFamily:'Noto Serif CJK SC',fontSize:28,fill:0xffffff,wordWrap:true,wordWrapWidth:1690,breakWords:true});
  const t=new PIXI.Text({text:window.TEXT_FULL,style});
  // wait a frame for texture gen
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const h=t.height;
  // binary line-count by checking layout: use CanvasTextMetrics on the text object
  const m=PIXI.CanvasTextMetrics.measureText(window.TEXT_FULL, t.style);
  return {h, lines:m.lines?.length, ls:m.lines, w:m.width, wordWrap:t.style.wordWrap};
});
console.log(JSON.stringify(r,null,1).slice(0,3000));
await b.close();
