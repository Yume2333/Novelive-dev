import { _electron as electron } from "playwright";

const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgJ", NOVELIVE_CREATOR_NOREADY: "3", NOVELIVE_READY_TIMEOUT_MS: "2500", NOVELIVE_RESTART_DELAY_MS: "300" },
  executablePath: process.env.ELECTRON_BIN,
});
const page = await app.firstWindow();
await page.waitForTimeout(15000); // 3 × 2.5s timeouts + restarts => circuit open
await page.screenshot({ path: (process.env.SHOTS_DIR ?? "./shots") + "/circuit-open-banner.png" });
const state = await page.evaluate(() => window.novelive.appState?.());
console.log("state:", JSON.stringify(state));
const btn = page.locator("button", { hasText: "重新启动" }).first();
if (await btn.count()) {
  await btn.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: (process.env.SHOTS_DIR ?? "./shots") + "/circuit-manual-restart.png" });
  const st2 = await page.evaluate(() => window.novelive.appState?.());
  console.log("after manual restart:", JSON.stringify(st2));
} else console.log("no restart button");
await app.close();
