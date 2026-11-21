import { chromium } from "playwright";
const run = async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("http://localhost:5199/");
  await p.fill('[data-testid="composer"]', "CJK markdown test");
  await p.click('[data-testid="send"]');
  await p.waitForSelector('[data-testid="proposal-card"]', { timeout: 10000 });
  const html = await p.locator(".nl-assistant").innerHTML();
  console.log("has <strong>:", html.includes("<strong>"));
  console.log("has <em or list:", html.includes("<li"));
  console.log("has blockquote:", html.includes("<blockquote"));
  console.log("has code block:", html.includes("<pre"));
  console.log("katex rendered:", html.includes("katex"));
  console.log("unclosed artifacts (literal ** or ```):", /\*\*|```/.test(await p.locator(".nl-assistant").innerText()));
  await b.close();
};
run().catch(e => { console.error(e); process.exit(1); });
