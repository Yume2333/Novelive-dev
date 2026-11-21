# r2-licenses — Novelive 依赖与拷贝资产许可审计

调研时间：2026-11-21。仓库：Novelive（AGPL-3.0-or-later，`LICENSE` 头部与尾部都含 "either version 3 of the License, or (at your option) any later version"）。

## 1. 结论

- **所有计划内 npm 依赖均可直接打包**：全部 MIT / Apache-2.0 / ISC / OFL-1.1 / BSD，无 copyleft 运行时依赖污染 AGPL-3.0-or-later 项目。
- **sharp 的 libvips 是 LGPL-3.0**：`@img/sharp-libvips-*` 二进制动态加载 `libvips-cpp.so.8.18.7`，满足"可替换/再链接"要求；只需在 THIRD_PARTY_NOTICES 中保留 libvips 的 LGPL-3.0 通知及源码指引。
- **Electron 自带两个必须进包的许可文件**：`LICENSE`（MIT）和 `LICENSES.chromium.html`（包含 Chromium+FFmpeg 等约 90 个组件通知）；electron-builder 默认会把 Electron zip 里的这两个文件原样打入安装包。
- **Electron 内置 libffmpeg.so**（LGPL-2.1+，Chromium ffmpeg_options 构建）。`LICENSES.chromium.html` 已包含 FFmpeg LGPL 通知；用户可替换 .so 满足 LGPL 重链接。我们没有用 ffmpeg CLI/库文件，只需把 Chromium 通知页一并打包。
- **Real-ESRGAN `x4plus-anime-6B` 权重 BSD-3-Clause**（xinntao 仓库 LICENSE + HF `license:bsd-3-clause`），允许再分发，需在 NOTICES 写版权行+BSD 文本；ncnn 运行时 BSD-3；Real-ESRGAN-ncnn-vulkan CLI 是 MIT。
- **WebGAL MPL-2.0 无 Exhibit B "Incompatible" 头**：源文件没有逐文件 MPL 头，按 §3.3 可作为 Secondary License 兼容代码并入 AGPL 项目；但 gap-ledger 已决定"重写不拷"——保留该决策即可，无许可阻塞。
- **PyInstaller bootloader exception**（GPL-2.0-or-later + 链接例外）允许把编译产物与专有/AGPL 应用合发；但 PyInstaller 6.22.3 打出的 Python 解释器本体是 PSF-2.0，仍需 NOTICE。
- **拷贝资产的实际义务很轻**：直接拷贝/改写文件需在文件头加 1-3 行版权行+SPDX；Apache-2.0 来源（codex、goose、novel2galgame、AI4VN、graphiti、mem0、cognee、antislop、slop-forensics、vitest-evals）若有 NOTICE 文件要并入 THIRD_PARTY_NOTICES——已验证 **codex、goose、openai-node、typescript 都带 NOTICE 或 ThirdPartyNotices.txt**，其中 typescript/playwright 是 dev-only 不进发行包。
- **AGPL-3.0 桌面应用的"源码提供"义务已天然满足**：仓库在 GitHub 公开（决定已定），只需在 About 页放 LICENSE 全文+GitHub 仓库链接+THIRD_PARTY_NOTICES 入口；§13"远程交互提供源码"对本地桌面场景不触发。
- **`.novelive` 作品包和用户导入的原文/图不是代码、不是 Novelive 的衍生作品**——AGPL 只覆盖 Novelive 二进制/源码，不污染创作者导出内容；可在作品包元数据里加 `producer` 字段但**不要**加任何"AGPL 影响作品"字样。
- **缺口**：docs 未写"每拷贝文件头部署名规则"、"THIRD_PARTY_NOTICES 生成方式"、about 页 LICENSE+NOTICES 入口。

## 2. 证据

### 2.1 npm 依赖（按 architecture.md §技术选型逐项核实）

| 包 | 版本（2026-11-21 npm latest） | license 字段 | AGPL-3.0-or-later 兼容 | 备注 |
|---|---|---|---|---|
| `@earendil-works/pi-ai` | 1.6.0 | MIT | ✅ | 包内无 LICENSE 文件；源仓 `earendil-works/pi` LICENSE 为 MIT（Copyright (c) 2025 Mario Zechner） |
| `@earendil-works/pi-agent-core` | 1.6.0 | MIT | ✅ | 同上 |
| `@earendil-works/pi-schema` | 1.6.0 | MIT | ✅ | 含 `THIRD_PARTY_NOTICES/typebox-LICENSE`（TypeBox MIT, Haydn Paterson） |
| `openai` | 7.62.0 | Apache-2.0 | ✅ | tarball 含 `package/LICENSE`、`src/_vendor/partial-json-parser/LICENSE`、`src/_vendor/zod-to-json-schema/LICENSE`、`src/internal/qs/LICENSE.md`；无顶层 NOTICE |
| `sharp` | 0.35.5 | Apache-2.0 | ✅ | `package/LICENSE` 是 Apache-2.0；`README.md:15` 声明依赖 libvips |
| `@img/sharp-libvips-{linux,darwin,win32}-*` | 1.3.4 | LGPL-3.0-or-later | ✅（动态链接） | `versions.json` 列 vips 8.18.7；`README.md` 附 26 个传递依赖许可证表：libvips/fribidi/glib/libexif/libheif/librsvg/pango/proxy-libintl 均 LGPLv3，cairo 是 MPL-1.1，aom BSD-2+AOM Patent 1.0，其余 MIT/BSD/zlib/libpng |
| `yauzl` | 3.4.0 | MIT | ✅ | — |
| `yazl` | 3.3.1 | MIT | ✅ | — |
| `react`/`react-dom` | 19.3.1 | MIT | ✅ | — |
| `react-router` | 8.5.2 | MIT | ✅ | prototype 用的 `react-router-dom@6.26.0` 旧版仍 MIT |
| `zustand` | 5.1.0 | MIT | ✅ | — |
| `i18next`/`react-i18next` | 27.2.2 / 18.0.3 | MIT | ✅ | — |
| `assistant-ui`（CLI 主包） | 0.0.136 | MIT | ✅ | 运行时是 `@assistant-ui/react` 0.15.37（MIT，依赖 radix-ui/assistant-stream/assistant-cloud/zustand 全 MIT）；`assistant-ui` CLI 本身含 setup-agent/jscodeshift 等 dev 依赖不进 dist |
| `streamdown` | 2.8.0 | Apache-2.0 | ✅ | 无 NOTICE；依赖 marked/unified/remark-*/rehype-*/hast-util-to-jsx-runtime 全 MIT |
| `lucide-react` | 1.77.0 | ISC | ✅ | tarball 含 ISC LICENSE（"Copyright (c) 2026 Lucide Icons and Contributors"） |
| `pixi.js` | 8.23.0 | MIT | ✅ | — |
| `pixi-filters`（替代已废弃的 `@pixi/filters`） | 6.1.5 | MIT | ✅ | npm 上 `@pixi/filters` 无 latest；实际包名是 `pixi-filters` |
| `@fontsource/noto-serif-sc` | 5.3.1 | OFL-1.1 | ✅ | tarball 含 `package/LICENSE`：Google Inc. SIL OFL-1.1 |
| `@fontsource/manrope` | 5.3.0 | OFL-1.1 | ✅ | — |
| `@fontsource/hanken-grotesk` | 5.3.0 | OFL-1.1 | ✅ | — |
| `electron` | 45.4.1 | MIT | ✅ | npm 元数据；打包时 electron-builder 会附带 Electron dist 里的 `LICENSE` + `LICENSES.chromium.html` |
| `electron-vite` | 6.0.0 | MIT | ✅ | dev only |
| `electron-builder` | 26.18.0 | MIT | ✅ | dev only；但产出安装包会含 `app-builder-bin@4.2.0`（MIT）自带的 `7za`/`nsis` 等工具——`7zip-bin` MIT，`nsis` 包 MIT 但安装产物 NSIS 运行时本身是 zlib/libpng 风格自由许可 |
| `electron-updater` | 6.8.11 | MIT | ✅ | dev+运行时 |
| `electron-log`（gap-ledger 提到"直接拷贝思路"） | 5.4.4 | MIT | ✅ | 若直接装包 MIT 无负担 |
| `typescript` | 7.0.2 | Apache-2.0 | ✅ | dev only；包内 `NOTICE.txt` 声明含 DefinitelyTyped MIT 材料——不进发行包 |
| `vite` | 8.3.8 | MIT | ✅ | dev only |
| `@biomejs/biome` | 2.6.8 | MIT OR Apache-2.0 | ✅ | dev only |
| `vitest` | 5.1.1 | MIT | ✅ | dev only |
| `playwright`/`@playwright/test` | 1.65.1 | Apache-2.0 | ✅ | dev only；tarball 含 `NOTICE`（基于 Puppeteer Apache-2.0）+ `ThirdPartyNotices.txt`——不进发行包 |
| `pnpm` | 12.21.0 | MIT | ✅ | 工具不进包 |
| `p-queue` | 10.0.0 | MIT | ✅ | gap-ledger D 表建议装 |
| `jsonrepair` | 3.15.0 | ISC | ✅ | gap-ledger 标"ISC≈BSD-2"，npm 字段为 ISC |
| `stylelint` | 18.1.0 | MIT | ✅ | dev only |
| `encoding-japanese` | 2.5.0 | MIT | ✅ | 若 TXT 解码采用 |
| `uuid` | 14.0.3 | MIT | ✅ | 若采用 |
| `ws` | 8.23.0 | MIT | ✅ | 若开发桥采用 |
| `i18next-browser-languagedetector`/`i18next-http-backend` | 8.3.1 / 4.1.0 | MIT | ✅ | 桌面 Electron 用不到 |

### 2.2 Python/系统层

| 组件 | 版本/来源 | license | 义务 |
|---|---|---|---|
| CPython 3.x | python.org 发行版 | PSF-2.0 | 许可文档：`python/cpython` LICENSE 头含 PSF 历史段；随安装包需附 PSF-2.0 文本 |
| `uv` | astral-sh | MIT OR Apache-2.0 | 不进发行包（开发工具） |
| PyInstaller | 6.22.3 | GPLv2-or-later + Bootloader Exception | PyPI `info.license` 明确 "GPLv2-or-later with a special exception which allows to use PyInstaller to build and distribute non-free programs (including commercial ones)"；`COPYING.txt` 确认 exception 允许合发。产物可随 AGPL 应用分发。 |
| Pillow | 13.0.0 | MIT-CMU | `LICENSE` 开头 "Copyright © 1997-2011 by Secret Labs AB … Pillow is the friendly PIL fork. It is Copyright © 2010 by Jeffrey 'Alex' Clark and contributors … MIT-CMU" |
| Real-ESRGAN-ncnn-vulkan CLI | xinntao/Real-ESRGAN-ncnn-vulkan | MIT | `LICENSE` 为 MIT License, Copyright (c) 2021 Xintao Wang |
| Real-ESRGAN 模型权重 `RealESRGAN_x4plus_anime_6B` | xinntao/Real-ESRGAN releases + `amd/realesrgan-x4plus-anime-6b` HF | BSD-3-Clause | repo LICENSE：BSD 3-Clause License, Copyright (c) 2021, Xintao Wang；HF `cardData.license: bsd-3-clause` |
| ncnn | Tencent/ncnn | BSD-3-Clause + 3rd-party 列表 | `LICENSE.txt`：ncnn 本体 BSD-3，附带若干 MIT/BSD 第三方组件；Python `ncnn` 包 1.0.20261020 = BSD-3 |
| `basicsr`（若选用 Python 推理路径） | 1.4.2 | Apache-2.0 | PyPI 字段；`xinntao/Real-ESRGAN` 推理也走 BSD-3 |
| `realesrgan`（PyPI） | 0.3.0 | BSD-3-Clause | PyPI |
| `gfpgan`/`facexlib` | 1.3.8 / 0.3.0 | Apache-2.0 | 仅若做脸部增强；目前 visuals.md 未列 |

### 2.3 Electron/Chromium 内置第三方

证据：`electron/electron` `BUILD.gn` 1905-1930 行
```gn
copy("electron_license") { sources=["LICENSE"] outputs=["$root_build_dir/{{source_file_part}}"] }
copy("chromium_licenses") { sources=["$root_gen_dir/components/resources/about_credits.html"]
                            outputs=["$root_build_dir/LICENSES.chromium.html"] }
group("licenses") { data_deps=[":chromium_licenses",":electron_license"] }
dist_zip("electron_dist_zip") { data_deps=[":electron_app",":electron_version_file",":licenses"] }
```
即每个 Electron release zip 自带 `LICENSE`（MIT）+ `LICENSES.chromium.html`（约 90 个 Chromium 三方组件通知，含 FFmpeg LGPL-2.1、libpng、zlib、brotli、ANGLE BSD、WebRTC BSD 等）。**electron-builder 打包会原样复制这两个文件**进 `resources/` 或安装目录；**不要删**。

ffmpeg 在 Electron 内置：BUILD.gn 1249-1413 行 `is_component_ffmpeg` → 单独 `libffmpeg.so/dylib/dll`。FFmpeg 本体 `LICENSE.md` 声明 "Most files under LGPL v2.1+; optional GPL parts not enabled by default"。`LICENSES.chromium.html` 里已有 FFmpeg 条目。LGPL 合规通过"用户可替换 .so"满足——保持 .so 单独文件即可，不要静态打进 binary。

### 2.4 拷贝资产源仓库许可（gap-ledger §D 逐项核实）

| 来源 | license（实测） | 义务 | 判定 |
|---|---|---|---|
| `earendil-works/pi`（= omp / `@oh-my-pi/*` 同源主体） | MIT（仓库 LICENSE，Copyright (c) 2025 Mario Zechner） | 拷代码/文案：文件头署名 + 附 MIT 文本进 NOTICES | ✅ |
| `sst/opencode` | MIT（仓库 LICENSE head: "MIT License Copyright (c) 2025 opencode"） | 同上 | ✅ |
| `block/goose` | Apache-2.0（仓库 LICENSE） | 文件头署名 + Apache-2.0 文本进 NOTICES；**无独立 NOTICE 文件已确认** | ✅ |
| `openai/codex` | Apache-2.0 | 同上；`codex-rs/prompts/templates/compact/summary_prefix.md` 实际路径已验证（`raw.githubusercontent.com/openai/codex/main/codex-rs/prompts/templates/compact/summary_prefix.md` 可 GET） | ✅ |
| `Bin-Huang/chatbox` | GPL-3.0 | **已决定只参考**（gap-ledger E 区），不能拷文件 | ⚠️ 只参考 |
| `CherryHQ/cherry-studio` | AGPL-3.0 | 我们项目本身 AGPL-3.0-or-later，**可同 license 拷**；但 gap-ledger 标"只参考" | ⚠️ 保守起见仍只参考 |
| `Narcooo/inkos` | AGPL-3.0 | 同 license 可拷但 ledger 已定"只参考" | ⚠️ 只参考 |
| `OpenWebGAL/WebGAL`（= MakinoharaShoko/WebGAL 上游） | MPL-2.0（无 Exhibit B "Incompatible" 通知，源文件不带 MPL 头） | 文件级 copyleft；§3.3 允许并入 Secondary License（GPL 系）。**已决定"重写不拷"**——若未来要拷片段，单文件可保留 MPL，其余 AGPL；最稳仍是按 ledger 不拷 | ✅ 已决策 |
| `renpy/renpy` | MIT 主体 + 部分 LGPL（`sphinx/source/license.rst`： "Most of Ren'Py is covered by MIT … Portions derived from LGPL source … generated project files dedicated to public domain under CC0"） | 拷转场枚举/思路：MIT 部分可拿；只参考 | ✅ |
| `monogatari/Monogatari` | MIT（LICENSE, Copyright (c) Diana Islas Ocampo） | 署名 | ✅ |
| `YarnSpinnerTool/YarnSpinner` | MIT（LICENSE.md） | 只参考先例，不拷 | ✅ |
| `foliate-js/foliate-js` | MIT（`johnfactotum/foliate-js` LICENSE：Copyright (c) 2022 John Factotum） | 署名 | ✅ |
| `gedoor/legado` | **仓库已清空**（main 分支只剩公告 README，2024 起因侵权纠纷关闭） | gap-ledger 写"GPL-3.0 只参考（数据不是代码，正则语义移植改写）"——但仓库现已无 LICENSE 文件可查；**风险：原 GPL 已无法确认，正则表达式的版权性弱** | ⚠️ 维持"只参考" |
| `gedoor/MyBookshelf` | GPL-3.0（LICENSE head 确认） | 同上——`app/src/main/assets/txtChapterRule.json` 有 26 条默认目录正则（含全角数字、章/节/卷/集/部/篇字符类）；GPL 项目内的 JSON 数据文件是否算代码有争议；**建议只参考语义重写规则，不逐字搬** | ⚠️ 只参考 |
| `yexiyue/TRNovel` | MIT（LICENSE, Copyright (c) 2024 yexiyue） | `src/novel/toc_rule.rs` + `docs/.../toc-rules.md` 含 `{name,pattern,example,kind,enable}` 数据模型 | ✅ |
| `FredericMN/AutoNovel` | MIT | 署名 | ✅ |
| `lin1753/novel2galgame` | Apache-2.0 | 署名 + Apache 文本进 NOTICES | ✅ |
| `yamasoo/text_2_visual_novel` | MIT | 署名 | ✅ |
| `ttsmallHot/AI4VisualNovel` | Apache-2.0 | 署名 | ✅ |
| `joeseesun/qiaomu-novel-generator` | MIT | 署名 | ✅ |
| `LifelongLazyLearner/qu-ai-wei` | MIT | 署名 | ✅ |
| `microsoft/graphrag` | MIT | 署名 | ✅ |
| `getzep/graphiti` | Apache-2.0 | 署名 | ✅ |
| `mem0ai/mem0` | Apache-2.0 | 署名 | ✅ |
| `topoteretes/cognee` | Apache-2.0 | 署名 | ✅ |
| `XZ-LI/ai-webnovel-pipeline` | MIT | 署名 | ✅ |
| `Anning01/novelvids` | MIT | 署名 | ✅ |
| `Supreme-Ultimate/novel-to-script-team` | MIT | 署名 | ✅ |
| `Chengsiyu-web/novel-to-storyboard` | MIT | 署名 | ✅ |
| `EQ-bench/eq-bench`（含 longform-writing-bench 的 README "License: MIT. Attribution appreciated but not required."） | MIT | 署名（可选署名但建议照做） | ✅ |
| `sam-paech/antislop-sampler` | Apache-2.0 | 署名 | ✅ |
| `sam-paech/slop-forensics` | MIT | 署名 | ✅ |
| `getsentry/vitest-evals` | Apache-2.0 | 署名 | ✅ |
| `BerriAI/litellm` | MIT（`LICENSE` 含 "Portions of this software are licensed as follows" 说明） | 数据文件 `model_prices_and_context_window.json` 拷数据时注明 MIT | ✅ |
| GenerativeAIPub 文章（表情清单） | 无代码、无 LICENSE | 已决定"移植改写" | ✅ |
| Claude Code compact / Naninovel | 闭源，只参考机制 | 无拷贝 | ✅ |

### 2.5 AGPL-3.0 桌面应用义务（FSF/GPL FAQ 与 §13 实测解读）

- **§5/§6** 分发二进制需"对应源码"——我们开 GitHub 仓库即可，About 放链接。
- **§13** 仅当"用户通过网络远程交互"时触发；桌面 Electron 单机运行不触发。即便未来加局域网/远程功能，§13 义务也只在"修改后版本且支持网络交互"——届时在 About 放 "Source: github.com/Novelive-Project/Novelive" 即可。
- **§7 additional terms**：我们 AGPL-3.0-or-later 可接受 Apache-2.0/MIT/ISC/BSD/OFL/LGPL/MPL-2.0（无 Exhibit B）依赖；不可收 GPL-3.0-only 依赖作为库（但 GPL-3.0 源我们只参考不拷）。
- **About 必须包含**：① `LICENSE`（AGPL-3.0 全文）② `THIRD_PARTY_NOTICES`（见 §3 计划）③ 项目源码仓库 URL ④ （推荐）版本号+构建 commit。

### 2.6 用户作品包是否被 AGPL 影响——**否**

`.novelive` 文件是**数据**（剧本文本、JSON、WebP 图片、SQLite），不是 Novelive 的代码或衍生作品。AGPL 只传染"the Program and works based on it"——导出作品只是**输出**。GNU FAQ 明确：GPL/AGPL 程序的输出物不自动继承 GPL，除非输出本身嵌入了程序的实质代码（例如 Bison 生成 parser 的特例才有输出豁免讨论）。我们的 `.novelive` 不嵌入 Novelive 可执行代码，**创作者的作品归创作者**。

同理：模型生成的剧本、图片也不归 Novelive 管。`project.db` 同理是用户数据。

### 2.7 版权头部约定（建议规则）

对**直接拷贝**的 MIT/Apache 文件，文件头加：
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Contains code derived from <上游仓名/文件路径>
// Copyright (c) <年> <上游版权持有人>, licensed under <原 license>
// See THIRD_PARTY_NOTICES for the full text.
```
对**移植改写**（语义重写但保留字段集/句子/结构）的文件：
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Ported from <上游仓/路径> (<原 license>).
// Copyright (c) <年> <上游版权持有人>.
```
对只参考思路无代码继承的：不加头。

**Apache-2.0 来源**逐文件署名同时，若有 NOTICE 文本（typescript/playwright 有 NOTICE 但只 dev 依赖不进包）需在 THIRD_PARTY_NOTICES 复写。已确认 codex、goose、openai-node 顶层无 NOTICE 文件，只需 LICENSE 文本+版权行。

## 3. 对照现有设计

| 发现 | 状态 | 对照 |
|---|---|---|
| 全部 npm 依赖许可与 AGPL-3.0-or-later 兼容 | 已覆盖 | `decisions.md:209-212`「以 AGPL-3.0 开源」+ `architecture.md:44-63` 技术选型清单 |
| sharp→libvips LGPL-3.0 动态链接合规 | 缺口 | `docs/architecture.md:55`「sharp」仅写包名；未在任何 doc 中记录 libvips LGPL 通知义务。**建议落点**：`docs/architecture.md` 技术选型表 sharp 行尾加"（libvips LGPL-3.0，NOTICES 声明）"+ `THIRD_PARTY_NOTICES` 计划进 `DESIGN.md` 或新 `docs/licensing.md` |
| Electron 自带 `LICENSE` + `LICENSES.chromium.html` 须随包 | 缺口 | `architecture.md:47` 只写 electron-builder 打包；未写 Chromium/ffmpeg 通知。**建议落点**：`docs/architecture.md` 构建与打包行补一句"打包产物自带 Electron LICENSE+LICENSES.chromium.html，不删" |
| Chromium 内置 libffmpeg LGPL-2.1 | 缺口 | 同上；我们没有自调 ffmpeg，只需保留 .so 独立文件+通知 |
| Real-ESRGAN `x4plus-anime-6B` BSD-3 权重可再分发 | 已覆盖 | `.workflow/research/handoff-defaults.md:67` 已记 "BSD-3，权重可再分发" |
| WebGAL MPL-2.0 无 Exhibit B → 可并入；但 ledger 已定"重写不拷" | 已覆盖 | `docs/player.md:11`「MPL-2.0 按文件级 copyleft 重写不拷」+ `gap-ledger.md:522` |
| legado 仓库现已关闭（只剩侵权公告） | 缺口 | `gap-ledger.md:535` 仍引 "legado `txtTocRule.json` 26 条默认目录正则"——**该 JSON 实际在 MyBookshelf 仓库**（`mybookshelf/app/src/main/assets/txtChapterRule.json`，GPL-3.0）。gap-ledger 把两库混写了；且 GPL JSON 数据能否按"正则语义移植"存在法律灰区，**建议保留"只参考"且注明语义重写** |
| PyInstaller bootloader exception 允许合发 | 缺口 | `decisions.md` 未提打包 Python 的工具选型；`architecture.md:59` 只写 uv。若采用 PyInstaller 需在 NOTICES 加 GPL+exception 文本 |
| OFL-1.1 字体可随包 | 已覆盖 | `architecture.md:52` fontsource 本地打包已选 |
| 每拷贝文件头署名规则 | 缺口 | 无任何 doc 约定；建议进 `AGENTS.md` 或 `.workflow/CONVENTIONS.md` 一节"第三方代码署名" |
| `THIRD_PARTY_NOTICES` 生成方式 | 缺口 | 建议落点：构建脚本读 `package.json` + 手工表 → 生成 `THIRD_PARTY_NOTICES.md` 进 `apps/desktop` extraResources；`docs/architecture.md` 打包行提一句 |
| About 页需放 LICENSE+NOTICES+仓库链接 | 缺口 | `docs/ux.md`/`product.md` 未列；建议进 `docs/ux.md` 设置/关于页清单 |
| 用户作品包不受 AGPL 影响 | 已覆盖（事实） | `docs/product.md:8` 已说"创作者导出 .novelive 分享"；无需改文档，但可在作品包 `metadata.json` 加 `generator: "Novelive/1.x"` 元数据字段 |

## 4. 可拷资产（建议落实清单 + 义务汇总）

### 直接装包，无需署名进源码（仅 NOTICES 汇总）
- 全部 npm 依赖：见 §2.1 表。
- Python 侧：`ncnn`、`realesrgan`（BSD-3）、`pillow`（MIT-CMU）、`basicsr`/`facexlib`/`gfpgan`（Apache-2.0，若启用）。
- 二进制：`realesrgan-ncnn-vulkan` CLI（MIT）、Real-ESRGAN `x4plus-anime-6B` 权重（BSD-3，≈64MB）。

### 逐文件署名（gap-ledger §D 全部"直接拷贝/移植改写"项适用）
| 类型 | 来源 | license | 需要做的事 |
|---|---|---|---|
| TS 代码（omp/opencode/goose/codex/vitest-evals/YN 等） | 各仓 | MIT / Apache-2.0 | 文件头 3 行注释（见 §2.7）；Apache-2.0 来源附 LICENSE 全文进 NOTICES |
| Markdown 提示词（omp/goose/codex/EQ-bench/AutoNovel/novel2galgame/t2vn/AI4VN/qiaomu/qu-ai-wei 等） | 各仓 | MIT / Apache-2.0 | 同上；提示词文本作为字符串/资源文件，头部或文件头注明 |
| 数据 JSON（litellm `model_prices_and_context_window.json`、slop 词表、MyBookshelf `txtChapterRule.json` 正则） | litellm MIT / sam-paech Apache+MIT / MyBookshelf GPL-3.0 | MIT / Apache-2.0 / GPL-3.0（⚠️） | litellm/slop 表可拷+署名；**MyBookshelf JSON 建议语义重写成我们自己的规则表，不逐字搬 26 条正则** |
| WebGAL 粒子算法（snow/rain/cherryBlossoms） | OpenWebGAL | MPL-2.0 | 按 ledger 已决定"重写不拷"；若未来改变，文件头保留 MPL 声明、文件级 copyleft |
| legado 章节正则 | gedoor/legado | 仓库已无 LICENSE；历史 GPL-3.0 | **不拷，仅参考语义重写**（同时规避 GPL 与"无 license"两风险） |

### THIRD_PARTY_NOTICES 计划（建议放进 `apps/desktop/resources/`）
```
THIRD_PARTY_NOTICES/
  index.md                    ← 目录+各依赖版权行汇总
  licenses/
    AGPL-3.0.txt              ← 我们项目
    Apache-2.0.txt
    MIT.txt
    ISC.txt
    BSD-3-Clause.txt
    BSD-2-Clause.txt
    LGPL-3.0.txt
    LGPL-2.1.txt
    MPL-1.1.txt
    MPL-2.0.txt
    OFL-1.1.txt
    PSF-2.0.txt
    MIT-CMU.txt
    Zlib.txt
    libpng.txt
    AOM-Patent-1.0.txt
    freetype-FTL.txt
    fontconfig.txt
    PyInstaller-Bootloader-Exception.txt
  components.md               ← 每依赖一段：名称/版本/许可/版权行/上游 URL
```
生成方式：`scripts/gen-notices.ts`（dev 脚本）遍历 `pnpm list --json --prod --depth=Infinity` + 手工组件表（Electron、libvips 26 个传递依赖、ffmpeg、Real-ESRGAN、Python 包、字体）→ 渲染 components.md + 拷 LICENSE 文本进 licenses/。electron-builder `extraResources` 打进安装包。

## 5. 需要所有者取舍的事

1. **MyBookshelf `txtChapterRule.json` 26 条 GPL-3.0 目录正则**：(a) 逐字搬（GPL 传染我们项目是 AGPL-3.0-or-later 允许 GPL-3.0 兼容，但 JSON 数据是否代码有争议）；(b) 语义重写成 `ChapterRule[]` 数据模型，正则自己再写一份（推荐，与 ledger "GPL 只参考"一致）；(c) 完全不用 legado 正则，自写一套。**推荐 (b)**——我们章节识别已决定"改写后搬" + legado 仓库本身已下线，风险最低。
2. **是否引入 PyInstaller 打 Python 解释器**：(a) PyInstaller one-dir 包 + bootloader exception（体积大，~80MB）；(b) uv 装系统 Python + 我们 spawn `python` 可执行文件（依赖用户环境）；(c) 嵌 embedded Python + site-packages（最干净，~30MB）。**推荐 (c)** 或先用 (b) M3 试跑——PyInstaller 许可合规没问题但体积最大。
3. **字体子集化**：OFL-1.1 允许子集化（修改需 rename，见 OFL §3 "Reserved Font Name"）。Noto Serif SC 全字重 ~10MB；若 M5 安装包限值紧，需要子集化（fonttools，MIT）。**推荐先用完整字体，M3 试打包后实测再决定**——但 OFL 禁止单卖字体，我们随包分发合规。
4. **WebGAL 是否改为"拷贝改写"**：已决定"重写不拷"；**维持决策**——MPL-2.0 文件级 copyleft 会让那几个文件 MPL 而周边 AGPL，可读性差。
5. **AGPL-3.0-or-later 还是 AGPL-3.0-only**：LICENSE 尾部含 "either version 3 or (at your option) any later version" —— 实际已是 -or-later。建议 `package.json.license` 字段写 `AGPL-3.0-or-later`、文件头 SPDX `AGPL-3.0-or-later` 保持一致。
6. **Electron LICENSES.chromium.html 放 About 页**：(a) About 内嵌渲染 html；(b) 只随安装包文件提供路径。**推荐 (b)**——html 内容太长不适合 UI，文件随包已满足合规。
7. **`.novelive` 作品包元数据**：可加 `generatedBy: "Novelive vX.Y"`（供用户追溯），**不写任何 license 字段**——作品版权归创作者，AGPL 不管。

---

*附：所有 npm latest 版本与 license 字段于 2026-11-21 经 `https://registry.npmjs.org/<pkg>/latest` 实测；所有 GitHub LICENSE 文件于同日经 `raw.githubusercontent.com` 实测。*
