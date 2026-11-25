# 11: 复核三平台产物和产品真实流程

**Effort:** m5-delivery
**Blocked by:** 08, 09, 10
**Covers:** W1, W2, W3
**Files:** tests/e2e/m5-delivery.spec.ts, .workflow/evidence/m5/closeout/, .workflow/owner-review.md
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `pnpm check && NL_REPLAY=strict pnpm test:e2e --grep 'M5 full delivery'` → 全链路与离线回归通过，各原生平台安装、导入、游玩、卸载另有回执。

**付费调用：** 只由协调者在交接中明确指定的串行主线会话按[用量计划](../../delivery-plan.md#测试模型与额度)调用付费模型，且每次调用须记入私有 `usage.csv`；其余会话只用 `NL_REPLAY=strict` 回放已提交的 cassette，缺档就在任务 `Progress` 记明所需用例并向主线会话请求录制。此规则不放宽本任务的离线限制，私有录制不提交。

- [ ] 汇总三个原生平台的安装回执，校验产物版本、校验和与下载位置；完整功能验收含两次确认、编辑、分享、更新；记录未签名和待抽查事项。

## Progress

- 2026-11-25 汇总复核（未归档，保持开放）：`08-linux-package` 已归档至 `.workflow/done/m5-delivery/08-linux-package.md`，但 `07-share-integration`、`09-windows-package`、`10-macos-package` 仍处于 `.workflow/tasks/m5-delivery/` 未归档，因此 `11-delivery-gate` 与 `m5-delivery` 规格保持开放（详见 [`.workflow/evidence/m5/closeout/README.md`](../../evidence/m5/closeout/README.md)）。
- 已有实测与待收口项：
  - `pnpm check`：已在当前 `HEAD` `7664e1a` 通过（2026-11-25，`NL_REPLAY=strict`，Node `v24.22.3`）：exit 0（`tsc` 无错、Biome + Stylelint exit 0 含 warnings、Vitest 74 文件通过 + 1 跳过，1110 用例通过 + 3 跳过，含 `tests/unit/m1a-w4-gate.test.ts` 4/4）。
  - `NL_REPLAY=strict pnpm test:e2e --grep 'M5 full delivery'`：已在当前 `HEAD` `7664e1a` 通过（2026-11-25，隔离 `/tmp/nl-win-09-e2e-*` HOME/XDG）：exit 0，1 passed（`31.3s`），完整覆盖创作、两次确认、编辑器修改、导出、更新与存档迁移、再导出分叉及四语言界面。
  - `M5 share and play offline`、`M5 share surfaces`、`M5 locales`：已在当前 `HEAD` `7664e1a` 与 `prototype` 合跑通过（exit 0，12 passed，`21.8s`），且 Linux AppImage、Windows CI 安装版与 macOS CI 安装版均已按各自证据通过；秘密/二进制泄漏扫描（`git grep` 与 `git ls-files`）为空。
  - Linux 原生未签名（Fedora 45 x86_64）：AppImage 构建与校验（SHA-256 `7826bfa39ac06deb6637e0e508927a6ab6411da01945938f089cb79addb93877`）、FUSE/`APPIMAGE_EXTRACT_AND_RUN=1` `m5-share.spec.ts`、隔离 XDG `xdg-mime`/`xdg-open`、4 语言界面及本地 HTTP 更新（含 `deb` 手动下载分支）全部通过（[Linux](../../evidence/m5/linux/README.md)）。
  - Windows CI 原生未签名（`windows-2025-vs2026`，run `45556159242`，`1ac35cb`）：NSIS 构建与校验（SHA-256 `0cce42ff41137ec2b7dd386c36d3345b46164125344fd929a5a134788a71d8e4`）、`/S` 安装/卸载、`HKCU` 注册表、许可、`m5-packaged.spec.ts` + `m5-share.spec.ts`、同版本 `latest.yml` 检查通过；物理 Explorer 双击 `.novelive`、新版 NSIS `quitAndInstall`、SmartScreen（未签名）与非 `zh-CN` 打包切换未测（[Windows](../../evidence/m5/windows/README.md)）。
  - macOS CI 原生未签名（`macos-15-arm64`，run `45556159242`，`1ac35cb`）：DMG + ZIP 构建与校验（DMG SHA-256 `ad463ef2d9527d4cd59195f41dc1c6bb1d04d4627e3217f96276823de865e6b3`；ZIP `89c5848b9d616480c6d54ab8491c0f55b83ddb4b9fd3795a2`）、DMG 挂载拷贝、`Info.plist`、许可、`m5-packaged.spec.ts`、`99.0.0` 未签名手动下载提示、`m5-share.spec.ts` 通过；物理 Finder 双击与 LaunchServices `open-file` AppleEvent、`.zip` 直接解压启动、Gatekeeper（未签名/未公证）与非 `zh-CN` 打包切换未测（[macOS](../../evidence/m5/macos/README.md)）。
  - 未签名与翻译状态：三平台均为 `0.0.0` 未签名构建，不配置正式自动更新源/公开 Release；繁中/英/日译文待所有者抽查。
