import { _electron as electron } from "playwright";

const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgD",
    ELECTRON_DISABLE_GPU: "1",
  },
  executablePath:
    process.env.ELECTRON_BIN,
});
const page = await app.firstWindow();
await page.waitForTimeout(4000);
// write a real png into cache via image test first
await page.evaluate(
  () =>
    window.novelive.call("config.update", {
      image: {
        baseUrl: "http://127.0.0.1:8899/v1",
        model: "i",
        apiKey: "k",
        concurrency: 8,
        retries: 3,
      },
    }).promise,
);
await page
  .evaluate(() => window.novelive.call("model.testImage", {}).promise)
  .catch(() => {});
await page.waitForTimeout(1500);
const checks = await page.evaluate(async () => {
  const out = {};
  for (const u of [
    window.novelive.resourceUrl("model-test/t2i.png"),
    "novelive://cache/model-test/t2i.png",
    "novelive://model-test/t2i.png",
    "novelive://cache%2Fmodel-test%2Ft2i.png",
  ]) {
    try {
      const r = await fetch(u);
      out[u] = { status: r.status, len: (await r.arrayBuffer()).byteLength };
    } catch (e) {
      out[u] = String(e);
    }
  }
  // <img> tag load
  const img = new Image();
  const ok = await new Promise((res) => {
    img.onload = () => res(true);
    img.onerror = (e) => res(String(e));
    img.src = "novelive://cache/model-test/t2i.png";
  });
  out.imgTag = ok;
  return out;
});
console.log(JSON.stringify(checks, null, 1));
await app.close();
