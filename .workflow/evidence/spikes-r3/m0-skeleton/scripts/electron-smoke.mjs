// CI Electron 冒烟：拉起 app -> 等 ready -> debug.sharpSmoke + debug.sqliteSmoke -> 退。
import { _electron as electron } from "playwright";

const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("../apps/desktop", import.meta.url).pathname,
  env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-ci-xdg" },
  executablePath: process.env.ELECTRON_EXEC,
});
const page = await app.firstWindow();
await page.waitForTimeout(4000);
const state = await page.evaluate(() => window.novelive?.appState?.());
const sharp = await page.evaluate(() => window.novelive?.call?.("debug.sharpSmoke", {}).promise ?? null);
const sqlite = await page.evaluate(() => window.novelive?.call?.("debug.sqliteSmoke", {}).promise ?? null);
console.log("state:", JSON.stringify(state));
console.log("sharp:", JSON.stringify(sharp));
console.log("sqlite:", JSON.stringify(sqlite));
await app.close();
if (state?.state !== "ready" || !sharp?.smoke?.ok || !sqlite?.smoke?.ok) process.exit(1);
