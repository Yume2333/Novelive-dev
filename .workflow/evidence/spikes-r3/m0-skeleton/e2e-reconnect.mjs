import { _electron as electron } from "playwright";
import { execSync } from "node:child_process";

const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgK" },
  executablePath: process.env.ELECTRON_BIN,
});
const page = await app.firstWindow();
await page.waitForTimeout(4000);
// set config so testText hits fake-llm
await page.evaluate(() => window.novelive.call("config.update", { models: { fast: { apiFormat: "openai-completions", baseUrl: "http://127.0.0.1:8899/v1", model: "fake-1", contextLength: 0, apiKey: "sk-fake", inheritFast: false } } }).promise);
const r1 = await page.evaluate(() => window.novelive.call("model.testText", { slot: "fast" }).promise);
console.log("before kill:", JSON.stringify(r1));
const pid = execSync("pgrep -f 'utility-sub-type=node.mojom.NodeService' | head -1").toString().trim();
process.kill(Number(pid), "SIGKILL");
console.log("killed creator pid", pid);
await page.waitForTimeout(4000); // auto-restart gen2
const state = await page.evaluate(() => window.novelive.appState());
console.log("state:", JSON.stringify(state));
const r2 = await page.evaluate(() => window.novelive.call("model.testText", { slot: "fast" }).promise);
console.log("after reconnect:", JSON.stringify(r2));
await app.close();
if (r1?.test?.ok !== true || r2?.test?.ok !== true || state?.state !== "ready") process.exit(1);
