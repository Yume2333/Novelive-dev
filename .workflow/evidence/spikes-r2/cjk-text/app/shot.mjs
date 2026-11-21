import { chromium } from 'playwright';
const [,,vw,vh,mode,steps] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:+vw,height:+vh}, deviceScaleFactor:1 });
const p = await ctx.newPage();
await p.goto('http://localhost:8777/test.html');
await p.waitForFunction(()=>document.getElementById('ready').textContent==='1',{timeout:15000});
await p.evaluate(()=>document.fonts.ready);
const g = await p.evaluate(()=>window.graphemes);
if(mode==='typewriter'){
  const n=+steps;
  // reveal n chars via both approaches simultaneously then screenshot
  await p.evaluate(async(n)=>{
    for(let k=0;k<n;k++){window.domStep();window.pixiStep();}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  },n);
  await p.screenshot({path:`../shot_${vw}x${vh}_type_${n}.png`});
  // report: line breaks so far (DOM live text lines via range rects; pixi height)
  const info = await p.evaluate(()=>{
    const live=[...document.querySelectorAll('#dlive .c.on')];
    const ys=[...new Set(live.map(s=>Math.round(s.getBoundingClientRect().top)))].sort();
    return {domLines:ys.length, pixiHeight:window.pixiLines()};
  });
  console.log(JSON.stringify({n, ...info}));
} else if(mode==='full'){
  await p.evaluate(()=>{window.domRevealAll();window.pixiRevealAll();});
  await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await p.screenshot({path:`../shot_${vw}x${vh}_full.png`});
}
await b.close();
