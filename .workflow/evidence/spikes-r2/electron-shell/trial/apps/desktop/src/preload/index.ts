import { contextBridge, ipcRenderer } from "electron";

let port: MessagePort | null = null;
const pending = new Map<number, { resolve: (v: unknown) => void }>();
let nextId = 1;

// The port arrives attached to the ipcRenderer event for channel "port".
ipcRenderer.once("port", (event) => {
  const ports = (event as unknown as { ports: MessagePort[] }).ports;
  port = ports[0];
  port.onmessage = (e) => {
    const m = e.data as { type: string; id?: number };
    if (m.type === "smoke-result" && m.id !== undefined) {
      pending.get(m.id)?.resolve(m);
      pending.delete(m.id);
    }
  };
});

contextBridge.exposeInMainWorld("trial", {
  smoke(): Promise<unknown> {
    return new Promise((resolve) => {
      if (!port) return resolve({ error: "no port" });
      const id = nextId++;
      pending.set(id, { resolve });
      port.postMessage({ type: "smoke", id });
    });
  },
});
