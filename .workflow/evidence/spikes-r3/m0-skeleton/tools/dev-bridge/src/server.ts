// dev-bridge 服务端：Node 里跑创作端，WebSocket(8765) 转发命令/事件，HTTP(8766) 提供缓存资源。

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { CreatorService } from "@novelive/creator";
import { WebSocketServer } from "ws";

const WS_PORT = 8765;
const HTTP_PORT = 8766;
const userData = process.env.NOVELIVE_USERDATA ?? "/tmp/novelive-dev-userdata";
const cacheDir = process.env.NOVELIVE_CACHE ?? join(userData, "cache");
mkdirSync(cacheDir, { recursive: true });

const service = new CreatorService({
  userDataDir: userData,
  cacheDir,
  generation: 1,
});

// ---------- WS ----------
const wss = new WebSocketServer({ port: WS_PORT });
wss.on("connection", (sock) => {
  const off = service.onFrame((f) => {
    if (sock.readyState === sock.OPEN) sock.send(JSON.stringify(f));
  });
  sock.send(JSON.stringify({ kind: "hello", generation: 1 }));
  sock.on("message", (data) => {
    try {
      void service.handle(JSON.parse(String(data)));
    } catch {
      /* 不合法 JSON：丢 */
    }
  });
  sock.on("close", () => {
    off();
    service.abortAll();
  });
});

// ---------- HTTP 资源 ----------
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = new URL(req.url ?? "/", "http://x");
  const m = url.pathname.match(/^\/cache\/(.+)$/);
  if (!m) {
    res.writeHead(404).end("not found");
    return;
  }
  const rel = normalize(decodeURIComponent(m[1]!));
  if (rel.startsWith("..")) {
    res.writeHead(403).end("escape");
    return;
  }
  const abs = join(cacheDir, rel);
  if (!existsSync(abs)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type":
      MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
  });
  res.end(readFileSync(abs));
}).listen(HTTP_PORT);

console.log(`dev-bridge: ws :${WS_PORT} http :${HTTP_PORT} cache=${cacheDir}`);
