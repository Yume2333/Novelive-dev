# work-package（R2 `.novelive` 包格式 ZIP 基准试验）

验证内容：合成 ~2GB、~2 万条目的 `.novelive` 结构 ZIP（webp 图 STORE + JSON DEFLATE + 小 filler），测 yazl 写出耗时/中央目录大小、yauzl 打开+枚举+随机读延迟 vs 裸 fs。支撑报告 `.workflow/research/refs/ext-2026-11-r2-work-package.md`；落到 `work-format.md` B11 包内约定（mimetype 首条/STORE/中央目录索引缓存）。

文件：`build-zip.mjs`（造合成包）、`read-bench.mjs`（yauzl open/枚举/随机读/4 条目 bundle）、`fs-bench.mjs`（裸 fs 对照）。打出的 `pkg-*.zip` 与 `extracted/` 各 ~2GB 未拷（脚本可再生）。

重跑：`npm install`（yazl ^3.3、yauzl ^3.4、`@earendil-works/pi-schema` ^1.6）→ `node build-zip.mjs pkg-deflate.zip` → `node read-bench.mjs pkg-deflate.zip 100` → `node fs-bench.mjs`。注意 `build-zip.mjs` 默认造 ~2GB 包（800×2.5MB webp + 2000 json + 18000 filler）；调小传 `node build-zip.mjs out.zip deflate 100 250000 200 1000`。

第三方依赖：yazl/yauzl（MIT）、pi-schema（MIT，自家依赖）。Node ≥18。
