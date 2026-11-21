import { chromium } from "playwright";

const shot = (page: any, name: string) => page.screenshot({ path: `shots/${name}.png`, fullPage: false });

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 780, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE_ERR:", m.text()); });
  page.on("pageerror", (e) => console.log("PAGE_ERR:", e.message));
  await page.goto("http://localhost:5199/");
  await page.waitForSelector('[data-testid="composer"]');

  // 1. send a message -> streams reasoning, text, tool card, proposal card
  await page.fill('[data-testid="composer"]', "重做第 3 章，加强冲突");
  await page.click('[data-testid="send"]');
  await page.waitForSelector('[data-testid="reasoning"]', { timeout: 5000 });
  await shot(page, "01-streaming");
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 8000 });
  await shot(page, "02-proposal-card");

  // 2. reject with reason -> run resumes, closing text
  await page.fill('[data-testid="reject-reason"]', "第 3 章刚改过，先不重做");
  await page.click('[data-testid="reject"]');
  await page.waitForSelector('[data-testid="proposal-result"]', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector(".nl-assistant .nl-branch") === null || true);
  await page.waitForTimeout(2500);
  await shot(page, "03-after-reject");

  // 3. edit the user message -> branch created
  await page.click('[data-testid="edit"]');
  await page.fill('.nl-edit textarea', "重做第 4 章，换个方向");
  await page.click('.nl-edit button:has-text("更新并重发")');
  await page.waitForSelector('[data-testid="proposal-card"]', { timeout: 8000 });
  await shot(page, "04-branch2-streaming");

  // approve this time
  await page.click('[data-testid="approve"]');
  await page.waitForSelector('[data-testid="proposal-result"]', { timeout: 5000 });
  await page.waitForTimeout(2000);
  await shot(page, "05-branch2-done");

  // 4. switch back to branch 1 via BranchPicker on the user message
  const branchCount = await page.locator(".nl-branch").count();
  console.log("branch pickers found:", branchCount);
  await page.locator('[data-testid="branch-prev"]').first().click();
  await page.waitForTimeout(500);
  await shot(page, "06-branch1-switched");

  // dump visible user texts to verify branch switch
  const userTexts = await page.locator('.nl-user [data-part-type], .nl-user').allInnerTexts();
  console.log("user msgs:", JSON.stringify(userTexts));

  await browser.close();
  console.log("OK");
};
run().catch((e) => { console.error("FAIL:", e); process.exit(1); });
