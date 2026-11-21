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
  await new Promise(r=>setTimeout(r,400));
  const keys=Object.getOwnPropertyNames(t);
  const out={h:t.height,w:t.width,keys:keys.filter(k=>/lay|text|bound|style/i.test(k))};
  // try to grab the measured lines from the text's private metrics
  for(const k of keys){ if(/metrics|lines/i.test(k)) out[k]=t[k]?.lines?.length ?? t[k]; }
  return out;
});
console.log(JSON.stringify(r,null,1));
await b.close();
