// Electron 主进程：窗口、utility process 管理、MessagePort 通道、novelive:// 协议、崩溃断路器、日志。

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { UtilityProcess } from "electron";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  net,
  protocol,
  shell,
  utilityProcess,
} from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const userData = app.getPath("userData");
const cacheDir = join(userData, "cache");
const logDir = join(userData, "logs");
mkdirSync(logDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const day = new Date().toISOString().slice(0, 10);
const log = (line: string, extra?: Record<string, unknown>) => {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  try {
    appendFileSync(
      join(logDir, `main-${day}.log`),
      `${new Date().toISOString()} ${line}${suffix}\n`,
    );
  } catch {
    /* ignore */
  }
};

// ---------- novelive:// 协议 ----------
// M0 只映射应用缓存目录：novelive://cache/<相对路径>。URL-decode + normalize，拒绝 .. 越界。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "novelive",
    privileges: {
      standard: false,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

function handleProtocol(req: Request): Promise<Response> | Response {
  try {
    const url = new URL(req.url);
    const bucket = url.hostname || url.pathname.split("/")[1] || "";
    const rawPath = url.hostname
      ? url.pathname
      : url.pathname.replace(/^\/[^/]+/, "");
    if (bucket !== "cache") {
      return new Response("unknown bucket", { status: 404 });
    }
    const decoded = decodeURIComponent(rawPath.replace(/^\//, ""));
    const rel = normalize(decoded);
    if (rel.startsWith("..")) {
      return new Response("path escape", { status: 403 });
    }
    const abs = join(cacheDir, rel);
    if (!existsSync(abs)) return new Response("not found", { status: 404 });
    const mime = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
    return net.fetch(pathToFileURL(abs).toString(), {
      headers: { "content-type": mime },
    });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
}

// ---------- 创作端管理：fork、握手、断路器、自动重启 ----------
type CreatorState = "starting" | "ready" | "down" | "circuit-open";

let win: BrowserWindow | null = null;
let creator: UtilityProcess | null = null;
let generation = 0;
let state: CreatorState = "starting";
let infraFailures = 0;
let _portReady = false;

const CIRCUIT_LIMIT = 3;

function sendToRenderer(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushAppEvent(event: Record<string, unknown>) {
  // 主进程代发 creator.ready / creator.down（主进程最清楚 utility 何时就绪）
  sendToRenderer("creator-event", event);
}

function startCreator(reason: string) {
  generation += 1;
  _portReady = false;
  const gen = generation;
  state = "starting";
  log("creator.fork", { generation: gen, reason });
  const entry = join(__dirname, "./creator.mjs");
  const child = utilityProcess.fork(entry, [], {
    serviceName: "novelive-creator",
    stdio: "pipe",
    env: {
      ...process.env,
      NOVELIVE_USERDATA: userData,
      NOVELIVE_CACHE: cacheDir,
      NOVELIVE_GENERATION: String(gen),
      NL_IMAGE_API_KEY: process.env.NL_IMAGE_API_KEY ?? "",
      NL_IMAGE_BASE_URL: process.env.NL_IMAGE_BASE_URL ?? "",
      NL_IMAGE_MODEL: process.env.NL_IMAGE_MODEL ?? "",
      NOVELIVE_CREATOR_NOREADY: process.env.NOVELIVE_CREATOR_NOREADY ?? "",
      NOVELIVE_READY_TIMEOUT_MS: process.env.NOVELIVE_READY_TIMEOUT_MS ?? "",
    },
  });
  creator = child;
  child.stdout?.on("data", (d) =>
    log("creator.out", { gen, line: String(d).trim().slice(0, 200) }),
  );
  child.stderr?.on("data", (d) =>
    log("creator.err", { gen, line: String(d).trim().slice(0, 500) }),
  );

  const readyTimeout = setTimeout(() => {
    if (state === "starting" && generation === gen) {
      log("creator.handshake.timeout", { gen });
      infraFailure("端口握手超时");
    }
  }, Number(process.env.NOVELIVE_READY_TIMEOUT_MS ?? 15000));

  // 先建 channel：一端给创作端（connect），一端先留着等窗口来取
  const { port1, port2 } = new MessageChannelMain();
  child.postMessage({ type: "connect" }, [port2 as never]);
  pendingRendererPort = port1;

  child.once("message", (m: { type?: string; generation?: number }) => {
    if (m?.type === "ready") {
      clearTimeout(readyTimeout);
      _portReady = true;
      state = "ready";
      infraFailures = 0; // 成功握手清零
      pushAppEvent({ type: "creator.ready", generation: gen });
      log("creator.ready", { generation: gen });
      deliverRendererPort(gen);
      if (crashMs > 0) {
        setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
        }, crashMs);
      }
    }
  });

  // 测试注入：NOVELIVE_CREATOR_CRASH_AFTER_READY=<ms> 时 creator 就绪后 ms 自杀
  // （复现「ready 后反复崩 → 连续 3 次基础设施失败 → 断路」）
  const crashMs = Number(process.env.NOVELIVE_CREATOR_CRASH_AFTER_READY ?? 0);
  child.on("exit", (code) => {
    clearTimeout(readyTimeout);
    log("creator.exit", { gen, code, state });
    if (state === "ready" && generation === gen) {
      pushAppEvent({
        type: "creator.down",
        generation: gen,
        reason: `退出码 ${code}`,
        willRestart: true,
        logDir,
      });
      state = "down";
      infraFailure(`ready 后退出 code=${code}`);
    } else if (state === "starting" && generation === gen) {
      state = "down";
      pushAppEvent({
        type: "creator.down",
        generation: gen,
        reason: `启动失败 code=${code}`,
        willRestart: false,
        logDir,
      });
    }
  });

  child.on("error", (e) => {
    log("creator.error", { gen, err: String(e) });
  });
}

let pendingRendererPort: Electron.MessagePortMain | null = null;

function deliverRendererPort(gen: number) {
  if (win && !win.isDestroyed() && pendingRendererPort) {
    win.webContents.postMessage("novelive-port", { generation: gen }, [
      pendingRendererPort,
    ]);
    pendingRendererPort = null;
  }
}

function infraFailure(reason: string) {
  infraFailures += 1;
  log("creator.infraFailure", { count: infraFailures, reason });
  if (infraFailures >= CIRCUIT_LIMIT) {
    state = "circuit-open";
    pushAppEvent({
      type: "creator.down",
      generation,
      reason: `连续 ${infraFailures} 次基础设施失败，已停止自动重试`,
      willRestart: false,
      logDir,
    });
    return;
  }
  const delay = Number(process.env.NOVELIVE_RESTART_DELAY_MS ?? 400);
  setTimeout(() => startCreator("auto-restart"), delay);
}

/** 手动重启按钮：重置断路器后拉起 */
function manualRestart() {
  infraFailures = 0;
  startCreator("manual");
}

// ---------- 窗口 ----------
app.whenReady().then(() => {
  protocol.handle("novelive", handleProtocol);

  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      sandbox: false, // sandbox:true 下 preload 不能是 ESM
      nodeIntegration: false,
    },
  });

  win.webContents.on("destroyed", () => {
    log("window.destroyed");
  });

  win.webContents.on("console-message", (_e, _level, message) => {
    log("renderer.console", { line: message.slice(0, 300) });
  });

  ipcMain.handle("pick-folder", async () => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle("get-log-dir", () => logDir);
  ipcMain.handle("open-log-dir", () => shell.openPath(logDir));
  ipcMain.handle("restart-creator", () => manualRestart());
  ipcMain.handle("app-state", () => ({
    state,
    generation,
    logDir,
    userData,
    cacheDir,
  }));

  startCreator("boot");

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  try {
    creator?.kill();
  } catch {
    /* ignore */
  }
});
