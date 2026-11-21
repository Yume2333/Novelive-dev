// 创作端（utility process）入口：接收 MessagePort，把命令帧交给 CreatorService。
// 主进程 fork 本文件构建产物（out/main/creator.mjs）。
import { initLog, log } from "./log.js";
import { CreatorService } from "./service.js";
import { sharpSmoke } from "./sharp-smoke.js";
import { sqliteSmoke } from "./sqlite-smoke.js";

declare const process: NodeJS.Process & {
  parentPort: {
    postMessage(msg: unknown, transfer?: unknown[]): void;
    once(
      event: "message",
      cb: (e: { data: unknown; ports?: unknown[] }) => void,
    ): void;
    on(
      event: "message",
      cb: (e: { data: unknown; ports?: unknown[] }) => void,
    ): void;
  };
};

const userData = process.env.NOVELIVE_USERDATA ?? "/tmp/novelive-userdata";
const cacheDir = process.env.NOVELIVE_CACHE ?? `${userData}/cache`;
const generation = Number(process.env.NOVELIVE_GENERATION ?? "1");

initLog(`${userData}/logs`, "creator");
log("creator.boot", {
  pid: process.pid,
  generation,
  node: process.versions.node,
});

const service = new CreatorService({
  userDataDir: userData,
  cacheDir,
  generation,
});

// 启动冒烟：node:sqlite + sharp（崩溃规避补丁版）
const sql = sqliteSmoke(cacheDir);
log("smoke.sqlite", sql);
const shr = await sharpSmoke(cacheDir);
log("smoke.sharp", shr);

interface PortLike {
  on(ev: "message", cb: (m: { data: unknown }) => void): void;
  on(ev: "close", cb: () => void): void;
  postMessage(m: unknown): void;
  start(): void;
}

process.parentPort.on("message", (e) => {
  const msg = e.data as { type?: string };
  if (msg?.type === "connect" && e.ports && e.ports.length > 0) {
    const port = e.ports[0] as PortLike;
    const send = (f: unknown) => port.postMessage(f);
    const off = service.onFrame(send);
    port.on("message", (m) => {
      void service
        .handle(m.data)
        .catch((err) => log("handle.error", { err: String(err) }));
    });
    port.on("close", () => {
      // port 随窗口销毁关闭：中止该端口在途请求
      service.abortAll();
      off();
      log("port.closed");
    });
    port.start();
    // 握手：告诉主进程创作端已就绪
    // NOVELIVE_CREATOR_NOREADY=<n>：generation<=n 时不握手（模拟启动挂起）
    if (generation > Number(process.env.NOVELIVE_CREATOR_NOREADY ?? 0)) {
      process.parentPort.postMessage({ type: "ready", generation });
    }
    log("port.connected", { generation });
  }
});

process.on("uncaughtException", (e) => {
  log("uncaught", { err: String(e?.stack ?? e) });
});
process.on("unhandledRejection", (e) => {
  log("unhandledRejection", { err: String(e) });
});
