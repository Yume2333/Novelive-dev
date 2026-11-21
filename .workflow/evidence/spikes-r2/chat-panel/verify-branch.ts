import { chromium } from "playwright";
const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 780, height: 900 } });
  await page.goto("http://localhost:5199/");
  await page.fill('[data-testid="composer"]', "重做第 3 章，加强冲突");
  await page.click('[data-testid="send"]');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 8000 });
  await page.click('[data-testid="approve"]');
  await page.waitForSelector('[data-testid="proposal-result"]');
  await page.waitForTimeout(2000);
  // edit to create branch
  await page.click('[data-testid="edit"]');
  await page.fill('.nl-edit textarea', "重做第 4 章");
  await page.click('.nl-edit button:has-text("更新并重发")');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 8000 });
  await page.click('[data-testid="approve"]');
  await page.waitForTimeout(2000);
  // count user msgs and check picker text
  console.log("user msgs:", await page.locator(".nl-user").count());
  console.log("picker:", await page.locator(".nl-branch").innerText());
  // click prev, then read visible user text
  await page.locator('[data-testid="branch-prev"]').first().click();
  await page.waitForTimeout(400);
  console.log("after prev:", await page.locator(".nl-branch").innerText());
  console.log("user msgs:", await page.locator(".nl-user").allInnerTexts());
  await page.screenshot({ path: "shots/07-verify-branch1.png" });
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
