import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 浏览器开发模式：dev-bridge 客户端在 window.novelive 上提供同一接口
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
