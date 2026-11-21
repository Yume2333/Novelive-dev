# player-demo（R3 播放器：文档设计撞上真剧本和真素材）

验证内容：按 `docs/player.md`/`work-format.md` 定的最小真播放器（Vite+React+PixiJS 8 命令式舞台+DOM 文本层）播 R3 两条管线的真实产出（ch01/02/23+strength 三档 .nvs），Chromium 实测三章全播完 0 console error。证实：快照 380–490B/句 restore 0.1ms、立绘「膝上贴底高 82%」摆位成立、judge readsAsVN ≈2.9/3；也证伪两处——**素材命名裂缝**（45 个引用素材只有 32 个能映射真图，13 个落占位图，注册表是硬需求）和 **faithful ≤120 在 720p 必爆**（3 行容量 1080p≈141 字、720p≈93 字）。支撑报告 `.workflow/research/refs/ext-2026-11-r3-player-demo.md`。

文件：`src/{compiler,stage}.ts`+`PlayerApp.tsx`+`main.tsx`（~800 行核心）、`src/compiled/*.json`（7 个剧本编译产物）、`tools/{compile,prepare-assets,drive,measure-memory,measure-overflow,overflow-report}.mjs`（编译诊断/素材桥+占位图/CDP 驱动/内存与溢出实测）、`public/assets/registry.json`（45 条注册表样例：mapped/placeholder/speaker 三类）、`measure/*.json`（逐句 overflow+快照尺寸原始数据）、`shots/*.jpg`（10 张证据图 1600×900：字幕/立绘/换表情/雨/CG 占位/超长句/读档恢复/ch23 CG/ch02 夜 CG）。`public/assets/*.webp` 真图与 `public/scripts/*.nvs` 剧本、`shots/*.png` 原始截图未拷（体积+书文）；占位图可 `prepare-assets.mjs` 重生成。

重跑：`npm i`（pixi.js 8.23+react 19+vite 7+sharp）→ `NL_IMG_OUT=<image-pipeline/out> node tools/prepare-assets.mjs`（生成 registry+占位图；缺真图时全占位）→ `npm run dev` → `http://localhost:5419/?script=ch01.nvs`（`?script=` 换章）；实测 `node tools/drive.mjs <script> <pageId>`、`node tools/measure-overflow.mjs`、`node tools/overflow-report.mjs`（需 CDP 驱动 chrome-devtools）。

第三方依赖：pixi.js 8.23.0、react 19.3.1、vite 7、sharp（占位图生成）、Chromium+CDP（实测工具）；剧本 .nvs 与图像管线 WebP 自备（text-pipeline/image-pipeline 归档可再生成）。
