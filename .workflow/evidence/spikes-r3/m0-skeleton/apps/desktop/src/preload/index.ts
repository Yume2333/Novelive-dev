// 预加载：contextBridge 只暴露 window.novelive。
// call(command,payload) 返回 { promise, cancel }；on(event,handler) 返回取消订阅；
// resourceUrl(path) 拼 novelive://；pickFolder() 走主进程对话框。
// requestId→cancel 映射在预加载侧（AbortSignal 不能跨 contextBridge）。
// generation 过滤：port 重建后旧 generation 的响应帧丢弃。
import { contextBridge, ipcRenderer } from "electron";

export interface NoveliveCall {
  promise: Promise<unknown>;
  cancel: () => void;
}

type Handler = (envelope: unknown) => void;

interface PendingEntry {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  generation: number;
}

let port: MessagePort | null = null;
let generation = -1;
const pending = new Map<string, PendingEntry>();
const handlers = new Map<string, Set<Handler>>();
let nextId = 1;
const portWaiters: Array<() => void> = [];

function onPort(p: MessagePort, gen: number) {
  if (port) {
    try {
      port.close();
    } catch {
      /* ignore */
    }
  }
  port = p;
  generation = gen;
  for (const [id, pe] of pending) {
    pe.reject({ code: "creator_down", message: "创作端连接重建，请求已中止" });
    pending.delete(id);
  }
  for (const w of portWaiters.splice(0)) w();
  p.onmessage = (e) => {
    const m = e.data as {
      kind?: string;
      generation?: number;
      requestId?: string;
      ok?: boolean;
      result?: unknown;
      error?: { code: string; message: string };
      envelope?: {
        scope?: string;
        scopeId?: string;
        event?: { type?: string };
      };
    };
    if (!m || m.generation !== generation) return;
    if (m.kind === "response" && m.requestId) {
      const pe = pending.get(m.requestId);
      if (pe) {
        pending.delete(m.requestId);
        if (m.ok) pe.resolve(m.result);
        else
          pe.reject(m.error ?? { code: "internal", message: "unknown error" });
      }
    } else if (m.kind === "event" && m.envelope) {
      const key = `${m.envelope.scope}:${m.envelope.scopeId}`;
      const set = handlers.get(key) ?? handlers.get("*");
      if (set) for (const h of set) h(m.envelope);
      const ts = handlers.get(`event:${m.envelope.event?.type}`);
      if (ts) for (const h of ts) h(m.envelope);
    }
  };
  p.start();
}

ipcRenderer.on("novelive-port", (event, payload: { generation?: number }) => {
  const ports = (event as unknown as { ports: MessagePort[] }).ports;
  if (ports && ports.length > 0) {
    onPort(ports[0]!, payload?.generation ?? 0);
  }
});

ipcRenderer.on(
  "creator-event",
  (_e, event: { type?: string; generation?: number; reason?: string }) => {
    if (event?.type === "creator.down") {
      for (const [id, pe] of pending) {
        pe.reject({
          code: "creator_down",
          message: String(event.reason ?? "创作端已停止"),
        });
        pending.delete(id);
      }
      generation = -1;
    }
    const set = handlers.get(`event:${event?.type}`);
    if (set) for (const h of set) h(event);
    const all = handlers.get("*");
    if (all) for (const h of all) h({ scope: "app", scopeId: "", event });
  },
);

function whenPort(): Promise<void> {
  if (port && generation >= 0) return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  portWaiters.push(resolve);
  return promise;
}

const api = {
  call(command: string, payload: unknown): NoveliveCall {
    const requestId = `r${nextId++}`;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    void whenPort().then(() => {
      if (!port || generation < 0) {
        reject({ code: "creator_down", message: "创作端未就绪" });
        return;
      }
      pending.set(requestId, { resolve, reject, generation });
      port.postMessage({
        kind: "command",
        generation,
        requestId,
        command,
        payload,
      });
    });
    return {
      promise,
      cancel: () => {
        if (port && pending.has(requestId)) {
          port.postMessage({ kind: "cancel", generation, requestId });
          pending
            .get(requestId)
            ?.reject({ code: "cancelled", message: "已取消" });
          pending.delete(requestId);
        }
      },
    };
  },

  on(event: string, handler: Handler): () => void {
    const key = event === "app" || event === "work" ? `${event}:` : event;
    let set = handlers.get(key);
    if (!set) {
      set = new Set();
      handlers.set(key, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  },

  resourceUrl(path: string): string {
    const rel = path.replace(/^\/+/, "");
    return `novelive://cache/${rel.split("/").map(encodeURIComponent).join("/")}`;
  },

  async pickFolder(): Promise<string | null> {
    return (await ipcRenderer.invoke("pick-folder")) as string | null;
  },

  async logDir(): Promise<string> {
    return (await ipcRenderer.invoke("get-log-dir")) as string;
  },
  async openLogDir(): Promise<void> {
    await ipcRenderer.invoke("open-log-dir");
  },
  async restartCreator(): Promise<void> {
    await ipcRenderer.invoke("restart-creator");
  },
  async appState(): Promise<unknown> {
    return ipcRenderer.invoke("app-state");
  },
};

contextBridge.exposeInMainWorld("novelive", api);
export type NoveliveApi = typeof api;
