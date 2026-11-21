import { _electron as electron } from "playwright";

const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgE" },
  executablePath:
    process.env.ELECTRON_BIN,
});
const page = await app.firstWindow();
await page.waitForTimeout(4500);
const r = await page.evaluate(() =>
  window.novelive
    .call("debug.sharpSmoke", {})
    .promise.then((r) => r)
    .catch((e) => e),
);
console.log("sharpSmoke:", JSON.stringify(r));
const r2 = await page.evaluate(() =>
  window.novelive
    .call("debug.sqliteSmoke", {})
    .promise.then((r) => r)
    .catch((e) => e),
);
console.log("sqliteSmoke:", JSON.stringify(r2));
await app.close();
