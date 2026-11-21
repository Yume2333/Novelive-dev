import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    // 创作端入口 = main build 的第二个 rollup input（electron-vite 6 没有 utility 配置段）。
    // 打包包（@novelive/*）bundle 进来；外部依赖（electron、sharp 补丁版、pi 系）externalize。
    // sharp 必须在 desktop 的 dependencies 里声明，否则 externalizeDepsPlugin 看不到它。
    plugins: [
      externalizeDepsPlugin({ exclude: ["@novelive/creator", "@novelive/ui"] }),
    ],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          creator: resolve(__dirname, "src/main/creator-entry.ts"),
        },
        output: {
          entryFileNames: "[name].mjs",
          chunkFileNames: "chunks/[name]-[hash].mjs",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        output: { entryFileNames: "[name].mjs" },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
