# R3 spike-archive：round-2 `/tmp/nl-r2/` 试验资产归档进 `.workflow/evidence/spikes-r2/`

2026-11-21。任务：把 `/tmp/nl-r2/` 下 round-2 一次性试验中**自写**的脚本/配置/夹具/测量数据拷进 repo（`/tmp` 重启即失），每个 spike 写 README，`gap-ledger-r2.md` D 表里的 `/tmp` 路径改指新位置。

## 1. 结论

1. **归档完成**：`.workflow/evidence/spikes-r2/` 新建，8 个 spike 子目录 + 顶层 README，共 **4.8 MB / ~117 文件**，低于 5 MB 上限。D 表 5 处 `/tmp/nl-r2/...` 路径全部改指 `.workflow/evidence/spikes-r2/...`。
2. **5 个 `/tmp/nl-r2/` 目录没有任何自写产物可拷**：`ImageApiCompat`（只解 new-api `nafiles` Go 源码片段，notes/sdks 全空）、`LicenseAudit`（全是第三方 repo/tarball/Electron 打包文件）、`R2Ledger`（openai npm tarball 解包+官方 dep.html）、`TextProviders`（官方文档 HTML+pi tarball）、`VnRuntime`（monogatari/renpy clone）。结论都在各 refs 报告里，资产不需要归档。
3. **秘密/host 扫描干净**：归档内 grep `sk-`/`Bearer `/`NL_IMAGE`/家目录绝对路径 全空；`https?://` host 只有 `registry.npmjs.org`、`localhost`、`opencollective.com`、`example.com` 四个公开地址。
4. **脚本里 `/tmp/nl-r2/...` 绝对路径已就地改写**为脚本相对路径（`os.path.dirname(__file__)`、`$(dirname $0)`、`OUT`/`BIN` 用 `__file__`/env var），归档后脚本在原目录即可重跑，不再依赖 `/tmp`。剩一处 `/tmp/nl-r2-trial-work` 是 Electron 试验的 env 默认值，保留无碍。
5. **D 表还有 6 处指 `bin/`、`aui-repo/`、`new-api` 等的资产行**——那是 third-party repo/二进制，本就不进 repo（E17「第三方文件不拷」已决策），位置列照原样保留，行内容未动。
6. **为省体积丢掉的**：`script-editor/{bundle,unified-bundle}.js`（esbuild 产物）、`chat-panel/package-lock.json`（206KB>200KB 上限）、`electron-shell/trial/{out,release,node_modules,pnpm-lock,desktop-0.1.0.tgz}`、upscale 全部 ncnn 二进制+模型权重+`work/out/` 全尺寸 4K/5K 输出图+`venv/`、upscale-sidecar 的 `upscayl-bin`/`models/`/`custom-models/`/`upscayl-{src,ncnn}`、cjk-text 三个 `.woff2` 子集与 4K 全尺寸 PNG、zh-tokens 大语料 `webnovel/hongloumeng/chapter_3k/book_300k`、work-package 打出的 ~2GB `pkg-*.zip` 与 `extracted/`。
7. **`upscale-sidecar/compare/grid_*.png` 原 2568-2934px 宽 >1600**，已 Lanczos 缩到 1600px 宽再拷（盲测裁切对比信息保留）。
8. **D 表一处与归档的小出入**：D 表 zh-tokens 行列的夹具含 `chapter_3k.txt`，该文件是红楼章节摘录（百 KB 级真实书文），按「长书文不进 repo」未拷——行内已注明「`chapter_3k.txt` 未拷，重测见该目录 README」。

## 2. 实测（方法、数据、命令）

### 2.1 拷贝规则

逐目录 `find` 判自写 vs 第三方：

- **拷**：`.mjs/.ts/.tsx/.py/.sh/.html/.css/.json/.yml/.tsv/.md` 自写文件、自写 config（`.npmrc`/`electron-builder.yml`/`electron.vite.config.ts`/`pnpm-workspace.yaml`/tsconfig）、自写夹具（`zh-tokens/corpus/` 三个小文件、upscale 合成 PNG）、测量数据（`bench.tsv`/`bench2.tsv`/`tokens.json`/`summary.md`/`report*.md`/`append.md`）、≤1600px 对比 PNG。
- **不拷**：`node_modules`、`.venv`/`venv`、`dist`/`out`/`release` 构建产物、`*.tgz`/`*.zip` 打包产物、`package-lock.json`/`pnpm-lock.yaml` 中 >200KB 者（`ChatPanel/trial/package-lock.json` 206KB，其余 <200KB 保留）、第三方 repo clone（`aui-repo`/`webgal`/`renpy`/`monogatari`/`new-api`(=nafiles)/`legado`/`mybookshelf`/`trnovel`/`lwb`/`upscayl-src`/`upscayl-ncnn`/`custom-models`/`pi-agent-core`）、二进制与模型权重（`bin/{realcugan,realesrgan,waifu2x,upscayl}`、`models/`、`*.bin/*.param/*.woff2`）、大语料书文（`webnovel.txt`/`hongloumeng.txt`/`chapter_3k.txt`/`book_300k.txt`）、>1600px 图片（grid 缩到 1600 后拷）。

### 2.2 大小

```
$ du -sh .workflow/evidence/spikes-r2
4.8M
$ du -sh .workflow/evidence/spikes-r2/*/
 24K  work-package/
 72K  zh-tokens/
 76K  electron-shell/
120K  cjk-text/
128K  script-editor/
544K  chat-panel/
1.2M  upscale-sidecar/
2.7M  upscale/
```

### 2.3 秘密/host 扫描（归档后原地跑）

```bash
cd .workflow/evidence/spikes-r2
grep -rn 'sk-[A-Za-z0-9_-]\{8,\}' .        # (empty)
grep -rn 'Bearer ' .                      # (empty)
grep -rn 'NL_IMAGE' .                     # (empty)
grep -rn '~/' .                            # (empty，家目录路径)
grep -rhoE 'https?://[A-Za-z0-9._-]+' . | sort -u
# http://localhost  https://example.com  https://opencollective.com  https://registry.npmjs.org
grep -rnoE '[\x{4e00}-\x{9fff}…]{119,}' . # 无 >120 字书文段（报告/夹具内的中文是我方撰写）
find . -name '*.png' -exec identify -format '%w %d/%f\n' {} \; | sort -rn | head -3
# 1600 grid_sprite_eye.png / 1600 grid_photo.png / 1600 grid_background.png  ← 全部 ≤1600
```

### 2.4 脚本就地化改写

`bench.sh`/`gen_test_imgs.py`/`run_model.sh`/`gen_hd_test.py`/`shot*.mjs`/`outline.mjs`/`measure.py` 里硬编码的 `/tmp/nl-r2/...` 全部改为 `__file__`/`$0` 相对路径（`run_model.sh` 二进制路径留 `UPSCAYL_BIN` env 覆盖）。改后 `python3 -c "import ast; ast.parse(...)"` 与 `bash -n` 验证通过。`upscale-sidecar/append.md` 里「本轮工作目录 `/tmp/nl-r2/R2UpscaleSidecar/`」一句改为指本目录。

### 2.5 D 表 repoint

`.workflow/research/gap-ledger-r2.md` 第 180/183/184/187/189 行的 `/tmp/nl-r2/...` → `.workflow/evidence/spikes-r2/...`。改完 `grep -rn '/tmp/nl-r2' gap-ledger-r2.md` 空（其它 `refs/` 报告里仍有 `/tmp` 引用，属本任务外的文档，归档 README 已注明对应关系）。

## 3. 与现有文档/决策的冲突或缺口

1. **`gap-ledger-r2.md:189`（zh-tokens 夹具行）**：原文「夹具 `{nvs_sample.nvs, bible_big.json, prompt_en.txt, chapter_3k.txt}`」暗示四件全可拷；实测 `chapter_3k.txt` 是红楼章节原文（book text），按归档规则不进 repo。行内已补注「`chapter_3k.txt` 未拷」。若 M0 单测需要 3k 字中文夹具，`measure.py` 重测命令在 `zh-tokens/README.md`（任意中文散文替代即可）。[建议] 不另行改动。
2. **`refs/ext-2026-11-r2-*.md` 全文仍引用 `/tmp/nl-r2/...`**（~30 处，含 `VnRuntime/renpy`、`VnRuntime/monogatari`、`work-package`、`zh-tokens`、`upscale`、`R2ElectronShell`、`ChatPanel`）：这些是「源」引用第三方 repo/试验目录。归档后自写部分对应 `.workflow/evidence/spikes-r2/<name>/`，第三方 clone 部分本就只「参考不拷」。是否把 refs 里的 `/tmp` 源引用改成「见 spikes-r2 归档 / 见原 repo」属 Integrator 的文档润色范围，本任务未动 refs。
3. **`electron-shell/README.md` 重跑说明**：`trial/` 里的 `pnpm-lock.yaml`（125KB<200KB）按规则其实可拷但**当时漏拷**——重跑 `pnpm install` 会自动生成，影响为零。[推断] 不构成阻塞。

## 4. 需要所有者取舍的事

1. **`upscale-sidecar` 的 blind-test 网格从 ~2900px 缩到 1600px**：信息仍在（8 列裁切对比可辨），但细节锐度略降。取舍：(a) 维持 1600px 归档（当前实现）；(b) 原尺寸拷（每张 ~1-2MB，总量仍在 5MB 内）。**推荐 (a)**：D 表只说「comparison images ≤1600px wide」，网格语义不靠全分辨率；要原图可 `make_grid.py` 重跑。
2. **`zh-tokens` 大语料不进 repo**：`webnovel.txt`（1MB 网文，HF Apache-2.0）与 `hongloumeng.txt`（公有领域）是 tokens.json 的全部来源。取舍：(a) 不拷（当前，书文规则）；(b) 拷 `tokens.json` 已足够、语料 README 给出处链接（当前实现）。**推荐 (b)**——数字已固化在 `results/`，重测可重新下载，repo 不该背 ~4MB 书文。
3. **第三方 clone（renpy/monogatari/webgal 等）不归档**：refs 报告里「源」引用它们的 `file:line`。取舍：(a) 维持只归档我方产物（当前，与 E17 一致）；(b) 把 refs 引用的那几个 renpy/monogatari 文件也拷进 evidence。**推荐 (a)**——它们是 MIT/MPL 第三方源码、非我方 spike，引一个 commit hash 比拷文件更合规；refs 报告已写 repo 名+路径，能找回。

## 5. 可直接拿去用的产物

- `.workflow/evidence/spikes-r2/` — 全部归档（README 索引在顶层 `README.md`）
- `.workflow/evidence/spikes-r2/electron-shell/trial/` — M0 `apps/desktop` 骨架照抄起点（`electron.vite.config.ts` 多入口、`utility-index.ts` 握手、`electron-builder.yml` 的 `extraResources`+`asarUnpack`、`.npmrc` hoisted、`packages/creator` workspace 结构）
- `.workflow/evidence/spikes-r2/script-editor/idtrack5.mjs` — 行 ID `StateField` 定稿（L40-84 可直接移植）；`idtrack.mjs`→`idtrack4.mjs` 是迭代历史
- `.workflow/evidence/spikes-r2/script-editor/{app,unified-app}.mjs` — speaker chip + ID gutter + `unifiedMergeView` 配置样板
- `.workflow/evidence/spikes-r2/chat-panel/src/{fakeBackend.ts,App.tsx}` — FakeCreatorBackend + ExternalStoreRuntime 接线，`packages/ui` 面板演化起点；`shots/` 7 张冒烟截图
- `.workflow/evidence/spikes-r2/zh-tokens/results/{summary.md,tokens.json}` — 分档 k 表全部原始数据；`corpus/` 三个自写夹具可作估算器单测输入
- `.workflow/evidence/spikes-r2/upscale/report-data.md` + `results/bench.tsv` — 三 CLI 计时/RSS/alpha MAE 原始数据；`pkg/sidecar/upscaler.py`+`*.spec` 是 Python sidecar 薄包装（A1 若不采纳 Python 可弃）
- `.workflow/evidence/spikes-r2/upscale-sidecar/append.md` — Upscayl 7 模型许可核对表 + 追加轮结论；`compare/grid_*.png` 盲测网格
- `.workflow/evidence/spikes-r2/work-package/{build-zip,read-bench,fs-bench}.mjs` — `.novelive` 包基准脚本（可复用测真包）
- `.workflow/evidence/spikes-r2/cjk-text/app/test*.html` — DOM 覆盖层+禁则+逐字打字机的最小可跑参考实现
- 已编辑：`.workflow/research/gap-ledger-r2.md`（D 表 5 行 repoint，无其它改动）
