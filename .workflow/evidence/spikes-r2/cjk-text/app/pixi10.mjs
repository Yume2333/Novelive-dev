import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1920,height:1080}})).newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1');
await p.evaluate(()=>document.fonts.ready);
const r = await p.evaluate(()=>{
  const PIXI=window.PIXI;
  const TEXT='“你说什么？”他猛地抬起头，声音在发抖——「不可能，绝对不可能！」她沉默了很久，才慢慢说：“我早就知道了。从东京来的信，三月十四日就到了，一共 7 封，你一封都没有看。”他忽然笑起来，笑得像哭：“原来你什么都知道……那我算什么？一个傻瓜，一个彻头彻尾的傻瓜！可是 Alice 说过，春天来的时候，一切都会好的。骗谁呢？骗谁呢……”雨点打在玻璃上，噼里啪啦，像无数只手在敲门。他想：如果那天我没有回头，如果那封信我看了，如果……可是没有如果。窗外，最后一班电车开走了，带走整个春天。';
  const style=new PIXI.TextStyle({fontFamily:'Noto Serif CJK SC',fontSize:28,fill:0xffffff,wordWrap:true,wordWrapWidth:1690,breakWords:true,lineHeight:53});
  const t=new PIXI.Text({text:TEXT,style});
  window.app.stage.addChild(t);
  window.app.render();
  const b0=t.getLocalBounds();
  // read the canvas texture lines by re-measuring with the same style
  const m=PIXI.CanvasTextMetrics.measureText(TEXT,style,undefined,true);
  return {bounds:{w:b0.width,h:b0.height},metricsLines:m.lines?.length,mh:m.height,lines:m.lines?.map(l=>l.slice(0,30))};
});
console.log(JSON.stringify(r,null,1));
await b.close();
