import { _electron as electron } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";

const ENV = { ...process.env, XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgH", NOVELIVE_RESTART_DELAY_MS: "2500" };
const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: ENV,
  executablePath: process.env.ELECTRON_BIN,
});
const page = await app.firstWindow();
await page.waitForTimeout(4000);
await page.screenshot({ path: (process.env.SHOTS_DIR ?? "./shots") + "/library-normal.png" });
// kill creator while window open
const pid = execSync("pgrep -f 'utility-sub-type=node.mojom.NodeService' | head -1").toString().trim();
console.log("creator pid", pid);
process.kill(Number(pid), "SIGKILL");
await page.waitForTimeout(1200); // during down window (restart delayed 2.5s)
await page.screenshot({ path: (process.env.SHOTS_DIR ?? "./shots") + "/crash-banner-down.png" });
await page.waitForTimeout(3500); // let it restart
await page.screenshot({ path: (process.env.SHOTS_DIR ?? "./shots") + "/after-recovery.png" });
const state = await page.evaluate(() => window.novelive.appState?.() ?? null);
console.log("state after restart:", JSON.stringify(state));
await app.close();
