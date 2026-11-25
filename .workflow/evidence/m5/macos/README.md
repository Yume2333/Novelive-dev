# M5 macOS 原生打包与实测验收

## 运行环境与 CI 来源

- **CI 运行：** [Native packages #45556159242](https://github.com/Yume2333/Novelive-dev/actions/runs/45556159242)（任务 `Package macos`，Job ID `139008599870`，状态 `completed` / `success`，耗时 7m19s：`2026-11-25T05:48:57Z` – `05:56:16Z`）
- **验证脚本：** `scripts/ci/verify-macos-package.sh`、`tools/package/verify-artifacts.mjs darwin`、`tests/e2e/m5-packaged.spec.ts`、`tests/e2e/m5-share.spec.ts`
- **被测提交（`headSha`）：** `1ac35cb0eaeb78c10355c00473a7112f00e7fb2c`（分支 `novelive-finish/07`；本文档与任务收口记录提交在后）
- **Runner 镜像与系统：** `macos-15-arm64`（镜像版本 `20261118.0550.1`），`macOS 15.8.2`（Build `24H232`，`arm64`）
- **构建与回放环境：** Node `24.22.3`、Electron `45.4.1`、`NL_REPLAY=strict`（0 付费 API 调用）

## 产物版本、校验和与获取位置

- **版本：** `Novelive 0.0.0`（未签名、未公证 DMG + ZIP，`Target: darwin/arm64`，`Host: darwin/arm64`）
- **保存位置：** GitHub Actions 运行 `45556159242` 的 Artifacts（保留 14 天，不提交二进制进 Git）：
  - 安装包与元数据：`novelive-macos-ARM64`（包含 `darwin-arm64-97gO3Y/artifacts/`）
  - 机器可读回执：`verification-macos-ARM64`（`macos-package-verification.json`）

| 产物文件名 | 大小（字节） | SHA-256 | `latest-mac.yml` SHA-512（Base64） |
| --- | ---: | --- | --- |
| `Novelive-0.0.0-mac-arm64.dmg` | `517,972,020` | `ad463ef2d9527d4cd59195f41dc1c6bb1d04d4627e3217f96276823de865e6b3` | `ooLTRO/vdVXdOgLn9zlnnRNYKpOSQpCNPeUzAAzkoBMr0B6+Y2KeRGTm2pwYPHqVn0dozjcaqDbMB9uA0hFgjA==` |
| `Novelive-0.0.0-mac-arm64.dmg.blockmap` | `540,355` | `81cb6704daeb3b48747f94468fe699b6d01b2747fd7a9877dd54d0e84248cd4c` | — |
| `Novelive-0.0.0-mac-arm64.zip` | `527,326,371` | `89c5848b9d616480c6d54ab8491c0f55b83ddb4b9fd87e78c98fefa2783795a2` | `znoQ7NMcF1tbhGixibcT3bp6Ue3RjGqSccoMTAL2k/76PHYdlGOGPJhsdFx96sdwgM2zBzD4QrWJRkJ7/Fooow==` |
| `Novelive-0.0.0-mac-arm64.zip.blockmap` | `545,291` | `94245b6d86070b1a099bbe89bc842caf25877f596c98f046bef43ae297fbd2e1` | — |
| `latest-mac.yml` | `512` | `d94e59473359f1ae870b01df3614669a9d7bbbd3e37e6a66126a01901168faa1` | — |

`BUILD.txt` 与 `SHA256SUMS` 已在 CI 及下载后本地 `sha256sum -c SHA256SUMS` 校验通过。

## 分步实测结果（`macos-package-verification.json`）

1. **`artifacts-and-checksums` — 通过：** 校验 `.dmg`、`.zip`、`.blockmap`、`latest-mac.yml`（`v0.0.0`）及 5 条 `SHA256SUMS` 记录。
2. **`dmg-mount-and-copy` — 通过：** 通过 `hdiutil attach -readonly -nobrowse` 挂载 `Novelive-0.0.0-mac-arm64.dmg`，并用 `ditto` 将 `Novelive.app` 拷贝至临时 `Applications` 目录。
3. **`info-plist-association` — 通过：** 通过 `plutil` 与 `PlistBuddy` 验证 `Contents/Info.plist`（`dev.novelive.desktop`，`0.0.0`）的 `CFBundleDocumentTypes` 已声明 `.novelive`（`Novelive Work Package`，角色 `Editor`）。
4. **`app-licenses` — 通过：** 验证 `Contents/Resources/` 下存在且非空：`licenses/LICENSE.txt`（`34,523` B）、`licenses/THIRD_PARTY_NOTICES.txt`（`976,433` B）、`app-update.yml`（`112` B）、`LICENSE.electron.txt`（`1,096` B）及 `LICENSES.chromium.html`（`5,598,206` B）。
5. **`packaged-runtime-and-playback` — 通过：** 运行 `tests/e2e/m5-packaged.spec.ts`（临时 `HOME` / `--user-data-dir`、`NL_REPLAY=strict`、`NL_UPDATE_URL` 指向本地回环源），确认 `novelive:about` 返回 `{ version: "0.0.0", packaged: true }`、命令行传入 fixture `.novelive` 导入并在删除源包后离线播放（Pixi 画布首像素 `[32, 48, 96]`），以及本地 `latest-mac.yml` 请求 3 次且 0 次自动下载安装包。
6. **`unsigned-manual-update-prompt` — 通过：** 本地源切至 `99.0.0` `latest-mac.yml` 后点击「检查更新」，确认弹出手动下载提示「版本 99.0.0 已可用，请手动下载。」（按钮 `稍后` / `打开下载`）并调用 `shell.openExternal` 指向 `Novelive-99.0.0-mac-arm64.dmg`，全程不触发 `.dmg`/`.zip` 自动下载或安装。
7. **`share-e2e-replay` — 通过：** 针对拷贝出的 `Contents/MacOS/Novelive` 跑通 `tests/e2e/m5-share.spec.ts` 全流程（导出、导入、删包离线播放、升级与存档迁移、导入为工程再导出）。
8. **`detach-dmg` — 通过：** 卸载 DMG 挂载点并清理临时目录。

## 未在本轮原生实测的项（及原因）

- **真实 Finder 图形界面双击与 LaunchServices `open-file` AppleEvent 分发：** 本轮通过命令行向 `Contents/MacOS/Novelive` 传参验证 `.novelive` 打开流程，并静态校验 `Info.plist` `CFBundleDocumentTypes`；未在 CI 中触发 Finder 双击或 `open -a` LaunchServices AppleEvent。
- **签名、公证与 Gatekeeper 校验：** M5 刻意输出未签名、未公证产物（`identity: null`、`notarize: false`、`dmg.sign: false`），未在启用 Gatekeeper 的外部用户桌面校验首次打开拦截提示。
- **`.zip` 产物解压后直接启动：** 本轮挂载并启动了 `.dmg` 内的 `Novelive.app`；`.zip` 产物已通过 `SHA256SUMS` 与 `latest-mac.yml` 的 SHA-512 / 字节大小校验，但未单独解压启动验证。
- **安装包多语言 UI 切换实测：** 本轮运行在默认 `zh-CN` 界面下。
