import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
const r = await p.evaluate(async()=>{
  const PIXI=window.PIXI;
  const style=new PIXI.TextStyle({fontFamily:'Noto Serif CJK SC',fontSize:28,fill:0xffffff,wordWrap:true,wordWrapWidth:1690,breakWords:true,lineHeight:53});
  const t=new PIXI.Text({text:window.TEXT_FULL,style});
  window.app.stage.addChild(t);
  window.app.render();
  await new Promise(r=>setTimeout(r,100));
  return {h:t.height,w:t.width};
});
console.log(JSON.stringify(r));
await b.close();
