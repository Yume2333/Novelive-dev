import { app, BrowserWindow, utilityProcess, MessageChannelMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logDir = process.env.TRIAL_LOG_DIR ?? join(app.getPath("userData"), "logs");
mkdirSync(logDir, { recursive: true });
const log = (m: string) => appendFileSync(join(logDir, "main.log"), `${new Date().toISOString()} ${m}\n`);

const pyScript = app.isPackaged
  ? join(process.resourcesPath, "python", "trial_sidecar.py")
  : join(__dirname, "../../../../python/trial_sidecar.py");

let resultWritten = false;

app.whenReady().then(async () => {
  const creatorEntry = join(__dirname, "./creator.mjs");
  log(`forking ${creatorEntry}`);
  const child = utilityProcess.fork(creatorEntry, [], {
    serviceName: "creator",
    stdio: "pipe",
    env: {
      ...process.env,
      TRIAL_WORK_DIR: process.env.TRIAL_WORK_DIR ?? join(app.getPath("userData"), "work"),
      TRIAL_PY_SCRIPT: pyScript,
      NODE_VERSION: process.versions.node,
    },
  });
  child.stderr?.on("data", (d) => log(`[creator-err] ${d}`));
  child.stdout?.on("data", (d) => log(`[creator-out] ${d}`));
  child.on("exit", (code) => log(`creator exited code=${code}`));

  const { port1, port2 } = new MessageChannelMain();
  const ready = new Promise<void>((resolve) => {
    child.once("message", (m: { type: string }) => {
      if (m.type === "ready") resolve();
    });
  });
  child.postMessage({ type: "connect" }, [port2]);
  await ready;
  log("creator ready");

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  win.webContents.postMessage("port", { type: "connect" }, [port1]);

  // headless trial: after load, run smoke via preload-exposed API from renderer console
  win.webContents.on("console-message", (_e, _level, message) => {
    log(`[renderer] ${message}`);
    if (message.startsWith("SMOKE:") && !resultWritten) {
      resultWritten = true;
      appendFileSync(join(logDir, "smoke-result.json"), message.slice(6) + "\n");
      setTimeout(() => app.quit(), 500);
    }
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }
});

app.on("window-all-closed", () => app.quit());
// safety quit after 30s for headless runs
setTimeout(() => { if (!resultWritten) { log("TIMEOUT no smoke result"); app.quit(); } }, 30000);
