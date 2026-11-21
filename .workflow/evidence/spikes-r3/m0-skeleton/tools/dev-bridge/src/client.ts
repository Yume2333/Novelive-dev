// dev-bridge 客户端：浏览器侧挂 window.novelive，接口与 preload 一致。
// WebSocket 8765 转发命令/事件，HTTP 8766 提供资源。
import type { CallHandle, NoveliveBridge } from "@novelive/ui";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export function installDevBridge({
  wsUrl,
  httpBase,
}: {
  wsUrl: string;
  httpBase: string;
}) {
  let ws: WebSocket | null = null;
  let generation = -1;
  const pending = new Map<string, Pending>();
  const handlers = new Map<string, Set<(e: unknown) => void>>();
  let nextId = 1;
  const waiters: Array<() => void> = [];

  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      for (const w of waiters.splice(0)) w();
    };
    ws.onclose = () => {
      generation = -1;
      for (const [id, p] of pending) {
        p.reject({ code: "creator_down", message: "dev-bridge 断开" });
        pending.delete(id);
      }
      setTimeout(connect, 800);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as {
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
      if (m.kind === "hello") {
        generation = (m as { generation?: number }).generation ?? 0;
        return;
      }
      if (
        m.generation !== undefined &&
        generation >= 0 &&
        m.generation !== generation
      )
        return;
      if (m.kind === "response" && m.requestId) {
        const p = pending.get(m.requestId);
        if (p) {
          pending.delete(m.requestId);
          if (m.ok) p.resolve(m.result);
          else p.reject(m.error ?? { code: "internal", message: "unknown" });
        }
      } else if (m.kind === "event" && m.envelope) {
        const set =
          handlers.get(`event:${m.envelope.event?.type}`) ?? handlers.get("*");
        if (set) for (const h of set) h(m.envelope);
      }
    };
  }
  connect();

  function whenOpen(): Promise<void> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waiters.push(resolve);
    return promise;
  }

  const bridge: NoveliveBridge = {
    call(command: string, payload: unknown): CallHandle {
      const requestId = `w${nextId++}`;
      const { promise, resolve, reject } = Promise.withResolvers<unknown>();
      void whenOpen().then(() => {
        pending.set(requestId, { resolve, reject });
        ws?.send(
          JSON.stringify({
            kind: "command",
            generation: Math.max(generation, 0),
            requestId,
            command,
            payload,
          }),
        );
      });
      return {
        promise,
        cancel: () => {
          if (ws && pending.has(requestId)) {
            ws.send(JSON.stringify({ kind: "cancel", generation, requestId }));
            pending
              .get(requestId)
              ?.reject({ code: "cancelled", message: "已取消" });
            pending.delete(requestId);
          }
        },
      };
    },
    on(event: string, handler: (e: unknown) => void) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => set?.delete(handler);
    },
    resourceUrl(path: string) {
      const rel = path.replace(/^\/+/, "");
      return `${httpBase}/cache/${rel.split("/").map(encodeURIComponent).join("/")}`;
    },
    async pickFolder() {
      const dir = window.prompt("工程目录绝对路径：", "/tmp/novelive-projects");
      return dir?.trim() ? dir.trim() : null;
    },
  };

  window.novelive = bridge;
}
