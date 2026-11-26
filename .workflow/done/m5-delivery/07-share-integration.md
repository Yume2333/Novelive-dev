# 07: 接通作品包导入、导出和文件关联

**Effort:** m5-delivery
**Blocked by:** 02, 03, 04, 05
**Covers:** W1, W2
**Files:** packages/creator/src/share/, packages/creator/src/entry.ts, packages/ui/src/App.tsx, apps/desktop/src/main/file-association/, apps/desktop/electron-builder.yml, tests/e2e/m5-share.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share and play offline'` → 不同应用数据目录执行导出→以作品包路径启动应用并导入→离线播放→更新→导入为工程。
**Base commit:** 1ac35cb0eaeb78c10355c00473a7112f00e7fb2c

- [x] 替换旧包到回收站，验证包资源协议与无模型播放器；将作品导入为新工程后再导出新身份。
- [x] 在原生桌面文件管理器中双击 `.novelive`，验证系统文件关联。（Windows/macOS 物理双击由所有者免测，见 Progress）

## Progress

- 严格回放通过。导出成功后由宿主更新工程版本；作品升级时，先停止并排空旧会话写入，再迁移。
- Linux 端已完成 AppImage 包装器完整回放（FUSE 与 `APPIMAGE_EXTRACT_AND_RUN=1`）及隔离 XDG 下的 `xdg-mime`/`xdg-open` 桌面文件关联验证（冷启动、删除原包离线播放、播放中第二实例升级、含空格/中文 `%U` `file://` URI 解码）；Windows/macOS 原生文件管理器双击待各自原生机验证。详见 [M5 Linux](../../evidence/m5/linux/README.md) 和 [M5 复核](../../evidence/m5/closeout/README.md)。
- Check after: `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share and play offline'` 在 `7664e1a` 通过；Linux AppImage 与 Windows/macOS CI 安装版各自通过（见上方证据）。
- Check waived: Windows Explorer / macOS Finder 物理图形界面双击 `.novelive` 不再实测，按已通过的 CI 原生命令行传参、注册表/`Info.plist` 关联核验与 Linux `xdg-open` 实测视为通过；所有者；2026-11-26
- Review: skipped — 所有者 2026-11-26 指示免除剩余物理真机项并直接通过；代码随前序任务已合入并经集成门禁复核。
