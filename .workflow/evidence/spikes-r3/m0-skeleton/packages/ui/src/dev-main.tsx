// 浏览器开发模式入口：dev-bridge 客户端先挂 window.novelive，再启动 React。
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function boot() {
  if (!window.novelive) {
    // dev-bridge 客户端（tools/dev-bridge）在 8765 提供 WebSocket 命令转发 + 8766 HTTP 资源
    const { installDevBridge } = await import("@novelive/dev-bridge/client");
    installDevBridge({
      wsUrl: `ws://${location.hostname}:8765`,
      httpBase: `http://${location.hostname}:8766`,
    });
  }
  createRoot(document.getElementById("root")!).render(<App />);
}

void boot();
