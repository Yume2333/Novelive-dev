import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:900,height:420},deviceScaleFactor:2})).newPage();
await p.goto('http://localhost:8777/outline.html');
await p.evaluate(()=>document.fonts.ready);
await p.screenshot({path:'../outline_2x.png'});
await b.close();console.log('ok');
