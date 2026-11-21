import { _electron as electron } from "playwright";

const app = await electron.launch({
  args: ["out/main/index.mjs", "--no-sandbox", "--disable-gpu"],
  cwd: new URL("./apps/desktop", import.meta.url).pathname,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: process.env.XDG_DIR ?? "/tmp/nl-r3-xdgC",
    ELECTRON_DISABLE_GPU: "1",
  },
  executablePath:
    process.env.ELECTRON_BIN,
});
const page = await app.firstWindow();
await page.waitForTimeout(4500);
// fill fast slot with fake endpoint via config.update
await page.evaluate(
  () =>
    window.novelive.call("config.update", {
      models: {
        fast: {
          apiFormat: "openai-completions",
          baseUrl: "http://127.0.0.1:8899/v1",
          model: "fake-1",
          contextLength: 0,
          apiKey: "sk-x",
          inheritFast: false,
        },
      },
      image: {
        baseUrl: "http://127.0.0.1:8899/v1",
        model: "img-1",
        apiKey: "sk-x",
        concurrency: 8,
        retries: 3,
      },
    }).promise,
);
const r1 = await page.evaluate(() =>
  window.novelive
    .call("model.testText", { slot: "fast" })
    .promise.then((r) => r)
    .catch((e) => e),
);
console.log("completions test:", JSON.stringify(r1));
// anthropic messages
await page.evaluate(
  () =>
    window.novelive.call("config.update", {
      models: {
        main: {
          apiFormat: "anthropic-messages",
          baseUrl: "http://127.0.0.1:8899",
          model: "fake-a",
          contextLength: 0,
          apiKey: "sk-x",
          inheritFast: false,
        },
      },
    }).promise,
);
const r2 = await page.evaluate(() =>
  window.novelive
    .call("model.testText", { slot: "main" })
    .promise.then((r) => r)
    .catch((e) => e),
);
console.log("anthropic test:", JSON.stringify(r2));
// openai responses
await page.evaluate(
  () =>
    window.novelive.call("config.update", {
      models: {
        writing: {
          apiFormat: "openai-responses",
          baseUrl: "http://127.0.0.1:8899/v1",
          model: "fake-r",
          contextLength: 0,
          apiKey: "sk-x",
          inheritFast: false,
        },
      },
    }).promise,
);
const r3 = await page.evaluate(() =>
  window.novelive
    .call("model.testText", { slot: "writing" })
    .promise.then((r) => r)
    .catch((e) => e),
);
console.log("responses test:", JSON.stringify(r3));
// image
const r4 = await page.evaluate(() =>
  window.novelive
    .call("model.testImage", {})
    .promise.then((r) => r)
    .catch((e) => e),
);
console.log("image test:", JSON.stringify(r4).slice(0, 600));
// cancel: start a call then cancel
page.evaluate(() => {
  const c = window.novelive.call("model.testText", { slot: "fast" });
  window.__c = c.promise.then((r) => "ok").catch((e) => JSON.stringify(e));
  c.cancel();
});
await page.waitForTimeout(500);
console.log("cancel:", await page.evaluate(() => window.__c));
// restart persistence check
await app.close();
