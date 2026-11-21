import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
const r = await p.evaluate(()=>{
  const seg=new Intl.Segmenter('zh',{granularity:'grapheme'});
  const s='蝉<ruby>x</ruby>字🇨🇳̄é👨‍👩‍👧';
  return [...seg.segment(s)].map(x=>x.segment);
});
console.log(JSON.stringify(r));
await b.close();
