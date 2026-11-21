import { _electron as electron } from "playwright";

const exe =
  process.env.ELECTRON_BIN;
const opts = {
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgD",
    ELECTRON_DISABLE_GPU: "1",
  },
  executablePath: exe,
};
let app = await electron.launch(opts);
let page = await app.firstWindow();
await page.waitForTimeout(4000);
await page.evaluate(
  () =>
    window.novelive.call("config.update", {
      project: { defaultDir: "/data/novelive-test" },
      image: {
        baseUrl: "http://127.0.0.1:8899/v1",
        model: "img-persist",
        apiKey: "sk-persist",
        concurrency: 6,
        retries: 2,
      },
    }).promise,
);
// novelive:// protocol: write a file into cache and fetch it via protocol
const proto = await page.evaluate(async () => {
  const url = window.novelive.resourceUrl("model-test/t2i.png");
  try {
    const r = await fetch(url);
    return { status: r.status, url, len: (await r.arrayBuffer()).byteLength };
  } catch (e) {
    return { err: String(e), url };
  }
});
console.log("protocol:", JSON.stringify(proto));
await app.close();
// restart, check config persisted
app = await electron.launch(opts);
page = await app.firstWindow();
await page.waitForTimeout(4000);
const cfg = await page.evaluate(
  () => window.novelive.call("config.get", {}).promise,
);
console.log(
  "persisted image model:",
  cfg.config.image.model,
  "conc:",
  cfg.config.image.concurrency,
  "dir:",
  cfg.config.project.defaultDir,
  "keyMasked:",
  JSON.stringify(cfg.config.image.apiKeyMasked),
);
await app.close();
