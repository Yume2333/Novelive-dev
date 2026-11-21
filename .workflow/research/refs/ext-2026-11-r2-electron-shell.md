# R2 Electron Shell — 打包、进程与宿主能力验证报告

调研日期：2026-11-21。试验目录 `/tmp/nl-r2/R2ElectronShell/trial`（home 磁盘，`/tmp` tmpfs 满后经软链接使用）。环境：Fedora 45、Node 24.18.0、pnpm 10.34.9、Electron **45.4.1**（内置 Node 24.22.3）、electron-vite **6.0.0**、electron-builder **26.18.0**、React 19.3.1、sharp（原版 0.35.5 → 换成 @janhapke/sharp-electron 0.35.4-electron.1）。

## 1. 结论

1. **端到端打通了整套骨架**：pnpm workspace + electron-vite（main/preload/renderer React 19）+ workspace 包 `@trial/creator` 被 utility process 消费 + `node:sqlite` WAL + sharp resize→webp + Python stdin/stdout 子进程 + MessagePort 直连渲染进程↔utility process。**dev、linux-unpacked、AppImage、deb 四种形态全部实测通过**（smoke 结果 JSON 一致）。
2. **最重大发现：sharp 0.35.x 在 Electron/Linux 下解码任何真实压缩图片必 SIGSEGV**（编码不崩）。这是 Electron 二进制内嵌系统 glib 与 libvips-cpp.so 私有 glib 符号冲突（electron#46323、sharp#4522/#4525）。**本机实测复现**（exit 139）。修复：用 `@janhapke/sharp-electron`（Apache-2.0，链接层修好符号冲突的 sharp/libvips 重建）通过 `pnpm.overrides` 整体替换 sharp。**决策里的 sharp 选型在 Linux 上不能直接用原版**——这是本报告唯一与既定设计冲突的点。
3. **preload + sandbox 组合有硬约束**：`sandbox:true` 时 preload 不能是 ESM `.mjs`（实测报 "Cannot use import statement outside a module"）。要么 preload 打 CJS，要么 `sandbox:false`（我们 contextIsolation:true 已在）。M0 规格没写 sandbox 选择，需要明确。
4. **electron-vite 6 不识别 `utility` 配置段**——只支持 main/preload/renderer 三个顶层 key。utility process 入口必须作为 **main build 的第二个 rollup input** 打进 out/main（实测 `input:{index, creator}` + `entryFileNames:[name].mjs` 输出 `creator.mjs` 可行）。
5. **pnpm + electron-builder 可行但有坑**：electron 版本必须写死（不能 `^`）；`node-linker=hoisted`+`shamefully-hoist` 下 electron-builder 走 "manual traversal" 正常收依赖；`asarUnpack` 必须同时覆盖 `**/*.node` 和 `**/*.so*`（只 un .node 不够，libvips-cpp.so 留在 asar 里 dlopen 失败）；`packageManager` 字段 pin pnpm 会触发自举失败（本机没全局 pnpm）。
6. **deb 在 Fedora 45 打包要过两关**：作者 email+homepage 元数据；fpm 自带 portable ruby 需要 `libcrypt.so.1`（libxcrypt-compat），Fedora 45 只带 libcrypt.so.2——M3 试打包的机器如果也是新版 Fedora 会撞同样的坑。
7. **safeStorage 在 Linux 无 keyring 时回落 `basic_text`**（密钥明文存磁盘），且 Electron 按 `XDG_CURRENT_DESKTOP` 认桌面，i3/sway/Hyprland 等一律 `basic_text`。**印证"不用 safeStorage、固定密钥简单加密"的决定是对的**——safeStorage 在 Linux 上的安全性对备份迁移这个需求没有任何增量。
8. **文件关联**：electron-builder `fileAssociations` 在 macOS（CFBundleDocumentTypes）+ NSIS（需 perMachine）+ **Linux 也生效**（deb 装 shared-mime-info XML + .desktop 加 MimeType）；但 AppImage 自 electron-builder 21 起不自我集成，`.novelive` 双击在 AppImage 下要依赖桌面环境/AppImageLauncher 侧集成——**deb 装的用户能双击，AppImage 用户大概率不能**，这是安装包形态决定的取舍。
9. **自动更新**：`autoUpdater`/`electron-updater` 官方只支持 macOS+Windows；**macOS 未签名/未公证包自动更新静默失败**（Squirrel.Mac 强校验签名）；Linux 没有内建自动更新（AppImage 有 electron-updater 的差量/全量更新，但和"GitHub Releases 检查下载"语义一致的是 AppImage+deb 走仓库/手动）。决策写的是"electron-builder 自动更新从 GitHub Releases"——**M5 只能对 Windows(NSIS)+macOS dmg(zip) 生效，Linux 要另行设计**。
10. **Python 打进安装包**：`extraResources` 拷 `python/` 目录实测可行（resources/python/trial_sidecar.py 进包、`spawn("python3", ...)` 在打包后正常运行——因为目标机有 python3）。**但这依赖系统 python3**；要自包含需 python-build-standalone 或 uv 打的 venv（M3 的 Real-ESRGAN venv 同理，须实测体积，见 handoff-defaults 已排）。

## 2. 证据

### 实测（本机，命令均可复跑）

- **trial 结构**：`trial/package.json`（pnpm.overrides→sharp-electron、onlyBuiltDependencies）、`pnpm-workspace.yaml`（packages/*+apps/*）、`.npmrc`（`node-linker=hoisted`、`shamefully-hoist=true`）、`packages/creator`（workspace 包，src/lib.ts 导出 `sharpSmoke`）、`apps/desktop`（main/preload/utility-index/renderer）、`python/trial_sidecar.py`。
- **构建**：`cd apps/desktop && pnpm build`（electron-vite 6.0.0）→ `out/main/{index.mjs,creator.mjs}`、`out/preload/index.mjs`、`out/renderer/`。实测：creator.mjs 里 workspace 包代码被内联（`sharpSmoke` 函数进 bundle），`sharp` 保持 external（`import sharp from "sharp"`）。
- **dev 冒烟**：`TRIAL_LOG_DIR=… xvfb-run electron out/main/index.mjs` → 渲染进程经 MessagePort 发 `{type:"smoke"}`，utility 返回：
  `{"sqlite":{"ok":true,"journalMode":"wal"},"sharp":{"ok":true,"format":"webp","width":4},"python":{"ok":true,"reply":"abc","bin":"python3"},"versions":{"node":"24.22.3"}}`（`/tmp/nl-r2-trial-logs6/smoke-result.json`）。
- **原版 sharp 解码崩溃**：lib.ts 改为 decode PNG（`sharp(pngBuf).raw().toBuffer`）后，utility 进程 `exit code=139`（SIGSEGV）；只编码（create→webp）不崩。`/tmp/nl-r2-trial-logs8/main.log`：`creator exited code=139`。
- **换成 sharp-electron 后**：`pnpm.overrides {"sharp":"npm:@janhapke/sharp-electron@0.35.4-electron.1"}`，同一份 decode 代码 → `sharp:{ok:true}`，dev 与打包后 linux-unpacked/AppImage 全过（logs A/B/C/D）。
- **打包**：`npx electron-builder --linux` → `NLTrial-0.1.0.AppImage`（142,366,423 B）、`desktop_0.1.0_amd64.deb`（115,531,760 B）。`dpkg-deb -c` 确认 `/opt/NLTrial/resources/python/trial_sidecar.py`、`app.asar.unpacked/node_modules/sharp/linux-x64/sharp/src/build/Release/{sharp-linux-x64-0.35.4.node,libvips-cpp.so.8.18.6}` 都在。
- **打包后运行**：`TRIAL_LOG_DIR=… xvfb-run ./release/linux-unpacked/desktop` → smoke JSON 同 dev；`./NLTrial-0.1.0.AppImage` → 同结果（logs C/D）。
- **sandbox:true 失败实测**：`Unable to load preload script … Cannot use import statement outside a module`（logs4/main.log），改回 `sandbox:false` 恢复。

### 文档/源码

- **electron-vite 6 只支持 main/preload/renderer**：`node_modules/electron-vite/dist/index.d.ts` 只定义 `MainViteConfig|RendererViteConfig|PreloadViteConfig` 三个顶层 key（grep 无 `utility`）。
- **fileAssociations 三平台**：electron-builder `scheme.json` 在 LinuxConfiguration/MacConfiguration/WindowsConfiguration/顶层均有 `fileAssociations`；Linux 实现在 `app-builder-lib/out/targets/LinuxTargetHelper.js:125-141`（生成 shared-mime-info XML）与 `:260-272`（.desktop `MimeType=`）。Windows 仅 NSIS+`perMachine:true`；macOS→`CFBundleDocumentTypes`。（electron.build docs v26 FileAssociation）
- **AppImage 不自我集成**：electron.build/v26/docs/appimage「Since electron-builder 21, desktop integration … is NOT handled by the AppImage itself」。
- **autoUpdater 平台限制**：electronjs.org/docs/latest/api/auto-updater「only macOS and Windows are supported. There is no built-in support for auto-updater on Linux」。
- **macOS 未签名自动更新静默失败**：github.com/nornzach/oh-my-pi-gui/issues/1（Squirrel.Mac/ShipIt 验签）；qodesmith/unimatrix-zero#5 同样结论。
- **safeStorage Linux 后端**：`electron.d.ts` `getSelectedStorageBackend()` 枚举 `basic_text|gnome_libsecret|kwallet(5/6)|unknown`；basic_text 触发条件"桌面环境不被识别或 `--password-store=basic`"。社区证据：emdash#1875、t3code#5427/#2880、electron#47436——i3/sway/未识别 DE 一律 basic_text=明文；safeStorage 加密结果跨机不可迁移（密钥在本机 keyring）。
- **powerSaveBlocker**：`electron.d.ts` `start('prevent-app-suspension'|'prevent-display-sleep')→id`、`stop(id)`、`isStarted(id)`；display-sleep 优先级恒高于 app-suspension。
- **单实例/文件打开**：`app.requestSingleInstanceLock()`、`'second-instance'` 事件（Win/Linux 双击第二文件走这里）、`'open-file'`（macOS，须启动早期监听）。
- **sharp Electron 警告**：`node_modules/sharp/dist/sharp.mjs:92-96` 主动 `process.emitWarning("…Electron…Linux…incompatible…", code:"SharpElectronLinux")`——sharp 官方明知此坑。
- **sharp-electron 机制**：`@janhapke/sharp-electron/README.md`+`index.js`——linux-x64 用 linker 层修好符号冲突的 sharp/libvips 重建（RPATH=$ORIGIN，patchelf），其他平台 re-export 真 sharp；Apache-2.0；`sharp-upstream` 别名依赖防 override 递归。仓库 github.com/janhapke/sharp-electron；注意 npm 上另有一个无关旧包 `sharp-electron@0.33.6`（lovell fork，旧），别装错。
- **deb 系统依赖**（electron-builder 自动写入）：`Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0`。
- **Python 捆绑选项**：Simon Willison TIL（Datasette Desktop 用 python-build-standalone 全量内嵌）、docs.astral.sh/python-build-standalone（uv 官方重分发构建，可拷）、farshid.co.uk 同款实践；extraResources 实测可行。

## 3. 对照现有设计

| 发现 | 判定 | 落点 |
|---|---|---|
| sharp 0.35.x 在 Electron/Linux 解码必崩 | **冲突** | `docs/architecture.md:55`（图片处理 sharp）、`decisions.md:330`（技术选型 sharp）——原版 sharp 在目标环境不可用。必须换 `@janhapke/sharp-electron`（Apache-2.0）或自重建同款补丁。 |
| utility process 入口要作 main 第二 rollup input | **缺口** | `apps/desktop` electron.vite.config 写法；`architecture.md:47`（electron-vite 构建主进程/预加载/界面/创作端入口）需要补一句"创作端入口=main build 多入口"。 |
| pnpm 下 electron 版本必须钉死 + onlyBuiltDependencies + hoisted linker | **缺口** | `.npmrc`、`package.json.pnpm.onlyBuiltDependencies`（electron/esbuild/sharp）；M0 骨架 spec 没写，CI `pnpm install --frozen-lockfile` 前要配。 |
| asarUnpack 须含 `**/*.so*`（不只 `*.node`） | **缺口** | electron-builder.yml；sharp/libvips 打包配置。 |
| sandbox:true 禁 ESM preload | **缺口/待取舍** | M0 规格（`m0-skeleton.md`）没定 sandbox。推荐 `sandbox:false`+`contextIsolation:true`（见 §5）。 |
| deb 打包需 author email+homepage；Fedora 45 需 libxcrypt-compat 给 fpm ruby | **缺口** | `decisions.md:538`（M3 Linux 试打包）的备注；打包机/CI 文档。 |
| `packageManager` 字段 pin pnpm 在无全局 pnpm 机器上自举失败 | 环境注意 | 开发环境要求装 pnpm（或留 packageManager 但预装 corepack）。 |
| safeStorage Linux basic_text 回落 | **已覆盖**（方向印证） | `decisions.md:354-359`（固定密钥简单加密）；本报告补：handoff-defaults.md:20 写 AES-256-GCM 源码常量——方案正确，GCM 比 5ire 的 CBC 更好，维持。 |
| powerSaveBlocker API | **已覆盖** | `architecture.md:71`、handoff-defaults.md:54（按活跃 run 启停）。补细节：`prevent-app-suspension` 够用（只防睡眠不防关屏）；`will-quit` 清理 + run 结束 stop(id)。 |
| fileAssociations Linux 也生效（deb 装 mime XML+desktop MimeType）；AppImage 不自我集成 | **缺口** | `owner-review.md:19`（注册 .novelive 关联）；`handoff-defaults.md:81`（双击导入）。需要：electron-builder `fileAssociations:[{ext:"novelive",mimeType:"application/x-novelive",description:"Novelive 作品包"}]` + `open-file`/`second-instance` 处理 + AppImage 用户双击不可用的预期说明。 |
| autoUpdater 只 Win+mac；mac 未签名不更新；Linux 无内建 | **冲突/缺口** | `decisions.md:398`（"electron-builder 自动更新 GitHub Releases"）对 Linux 不成立；`owner-review.md:9`（M5 只出未签名包）意味着 macOS 自动更新也不可用。M5 需写清：Linux=AppImage 走 electron-updater 的 AppImage 更新器或提示手动下载；macOS 未签名只能"提示新版+手动下载"。 |
| Python extraResources 可行但依赖系统 python3 | **缺口** | `architecture.md:26,47`（Python 进程作为附带资源）；M3 spec 需写清：自带 python-build-standalone 或 venv（`python/` 目录），不能假定目标机有 python3。 |

## 4. 可拷资产

| 资产 | 位置 | 许可 | 大小/说明 |
|---|---|---|---|
| `@janhapke/sharp-electron@0.35.4-electron.1` | npm | Apache-2.0 | ~20MB（含重打 libvips）。直接 `pnpm.overrides` 用，不拷代码。AGPL-3.0 兼容（Apache-2.0 → AGPL OK）。 |
| `trial/` 骨架（pnpm workspace + electron-vite 多入口 + MessagePort 直连 + extraResources python + electron-builder.yml） | `/tmp/nl-r2/R2ElectronShell/trial` | 自写 | M0 `apps/desktop` 直接照抄配置；`utility-index.ts` 的 ready/connect/smoke 帧是现成握手样板。 |
| `electron-builder.yml` 关键段：`extraResources[{from:"../../python",to:"python"}]`、`asarUnpack["**/*.node","**/*.so*","node_modules/sharp/**","node_modules/@img/**"]` | trial/apps/desktop | 自写 | sharp-electron 版路径是 `node_modules/sharp/linux-x64/...`，原版是 `node_modules/@img/**`；两条都写可兼容。 |
| `.npmrc`：`node-linker=hoisted`、`shamefully-hoist=true` | trial | 自写 | electron-builder 对 pnpm 默认 isolated 布局的依赖收集更不可靠，hoisted 实测走 manual traversal 成功。 |
| python-build-standalone 发行版 | github.com/astral-sh/python-build-standalone | MIT（Python 本体 PSFL） | M3 自包含 Python 用；`uv python install` 同源。 |

## 5. 需要所有者取舍的事

1. **sharp 用哪份**（最重要）：
   - (a) `pnpm.overrides` → `@janhapke/sharp-electron`（个人维护单包 fork，只补了 linux-x64；arm64 Linux 直接 throw）；
   - (b) 照 janhapke 的方法自重建 sharp+libvips（patchelf RPATH+符号隐藏），可复现但每升级要重打；
   - (c) 解码全搬进 Python sidecar / worker_threads（GLib 冲突是进程内问题，搬到非 Electron spawn 的真 node 子进程也能规避——但 spawn node 又要随包带 node 运行时）。
   - **推荐 (a)**：一行 override、Apache-2.0、只服务 linux-x64（我们的 M3 目标）；把它当临时方案，跟踪 electron#46323 上游修复后回退官方 sharp。风险：个人仓库断更——届时降级 (b)。
2. **preload sandbox**：`sandbox:false`+`contextIsolation:true`（现状，preload 可 ESM，Node 集成关闭，攻击面靠 contextBridge 单 API）vs `sandbox:true`+preload 打 CJS（更强沙箱，渲染进程彻底无 Node）。**推荐 `sandbox:false`**——M0  preload 要用 `ipcRenderer` 和 MessagePort，contextIsolation 已挡住界面碰 Node；后续如要再收，electron-vite preload 输出改 CJS 一行的事。
3. **Linux 自动更新形态**（M5）：(a) AppImage 走 electron-updater 的 AppImage 更新（zsync 差量）；(b) deb/发行版仓库让用户自己升；(c) 只弹"有新版本+下载链接"。**推荐 (a)+(c) 兜底**：AppImage 是唯一可分发的自更新 Linux 形态；deb 安装的去仓库/官网升。
4. **`.novelive` 文件关联**：deb 装的用户双击可用；AppImage 用户不行（electron-builder 21 起不自我集成）。要不要在 AppImage 首次启动时自己写 `~/.local/share/mime` + `xdg-mime default`？**推荐做**（30 行，AppImage 用户是 Linux 大头），但放 M5 与安装包一起做，并在 ux 文档写明"双击导入仅安装版保证可用"。
5. **Python 分发**：`extraResources` 拷裸 `.py` 依赖系统 python3（实测行）；自包含须 python-build-standalone ~30MB+venv 再装 Real-ESRGAN 权重。**推荐自包含**（handoff-defaults.md:70 已排 M3 实测体积耗时），系统 python3 在 Windows 基本没有、macOS 版本不定，不可靠。
6. **macOS 未签名自动更新**：M5 只出未签名包（owner-review.md:9）→ macOS 自动更新不可用，只能 dmg+提示。**建议 M5 规格写明"macOS 自动更新挂起，待签名/公证"**，electron-updater 代码先按 Win/Linux 写，macOS 分支只检查不下载。
