# 07: 接通作品包导入、导出和文件关联

**Effort:** m5-delivery
**Blocked by:** 02, 03, 04, 05
**Covers:** W1, W2
**Files:** packages/creator/src/share/, packages/creator/src/entry.ts, packages/ui/src/App.tsx, apps/desktop/src/main/file-association/, apps/desktop/electron-builder.yml, tests/e2e/m5-share.spec.ts
**Read first:** `.workflow/specs/m5-delivery.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm test:e2e --grep 'M5 share and play offline'` → 不同应用数据目录执行导出→以作品包路径启动应用并导入→离线播放→更新→导入为工程。

- [x] 替换旧包到回收站，验证包资源协议与无模型播放器；将作品导入为新工程后再导出新身份。
- [ ] 在原生桌面文件管理器中双击 `.novelive`，验证系统文件关联。

## Progress

- 严格回放通过。导出成功后由宿主更新工程版本；作品升级时，先停止并排空旧会话写入，再迁移。
- Linux 端已完成 AppImage 包装器完整回放（FUSE 与 `APPIMAGE_EXTRACT_AND_RUN=1`）及隔离 XDG 下的 `xdg-mime`/`xdg-open` 桌面文件关联验证（冷启动、删除原包离线播放、播放中第二实例升级、含空格/中文 `%U` `file://` URI 解码）；Windows/macOS 原生文件管理器双击待各自原生机验证。详见 [M5 Linux](../../evidence/m5/linux/README.md) 和 [M5 复核](../../evidence/m5/closeout/README.md)。
