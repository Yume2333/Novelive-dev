# 08: 构建并实测 Linux 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/linux/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:linux` → 实际运行生成的 AppImage，打开作品包并离线播放；验证 AppImage 更新和 deb 手动提示分支。

- [x] 在 Linux 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。

## Progress

- 已在 Fedora 45 x86_64 完成 `package:linux` 构建（`Novelive 0.0.0`，AppImage SHA-256 `7826bfa39ac06deb6637e0e508927a6ab6411da01945938f089cb79addb93877`，`latest-linux.yml` 校验通过），修复了 `asar: false` 在 `APPIMAGE_EXTRACT_AND_RUN=1` 下输出过大导致 `execFile` 失败的问题与 `file://` URI 解码问题。
- 已直接通过 AppImage 包装器跑通 FUSE 与 `APPIMAGE_EXTRACT_AND_RUN=1` 的完整分享/离线游玩/升级/分叉回放、隔离 XDG `xdg-open` 文件关联（冷启动、第二实例、`file://` URI）、4 语言切换与持久化截图，以及本地 HTTP 更新源（AppImage 同版本/新版本下载与非 AppImage `deb` 手动下载提示分支）。详见 [M5 Linux 验收记录](../../evidence/m5/linux/README.md)。
- Check after: `node tools/upscale/fetch.mjs linux && NL_REPLAY=strict pnpm --filter @novelive/desktop run package:linux` → `Novelive 0.0.0` (`sha256sum -c SHA256SUMS` OK, `7826bfa3...`)；AppImage 包装器 FUSE (`9.7s`) 与 `APPIMAGE_EXTRACT_AND_RUN=1` (`18.8s`) 均通过 `m5-share.spec.ts`；隔离 XDG `xdg-open`、AppImage 4 语言与本地 HTTP 更新（AppImage 同版本/新版本 + `deb` 手动提示分支）均通过实测（2026-11-25 于 nl-06 Fedora 45 x86_64）。
- Review: skipped — 本窗口由并行子代理各自实测并由协调者复核后随分支合入统一验收。
