# 09: 构建并实测 Windows 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/windows/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:windows` → 实际安装 NSIS 包，双击作品包离线播放，验证 NSIS 更新和卸载。

- [ ] 在 Windows 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。

## Progress

- 已在 CI 原生 `windows-2025-vs2026`（Windows Server 2025 Datacenter `10.0.26100`）跑通（[Native packages #45556159242](https://github.com/Yume2333/Novelive-dev/actions/runs/45556159242)，commit `1ac35cb0eaeb78c10355c00473a7112f00e7fb2c`，回执见 [Windows](../../evidence/m5/windows/README.md)）：`package:windows` 输出 NSIS 安装包与 `latest.yml` 并通过 `SHA256SUMS` / SHA-512 校验；完成 `/S /D=...` 静默安装、`HKCU` `.novelive` 注册表关联与 ProgID 检查、许可文件检查、已安装 `Novelive.exe` 导入 `.novelive` 删包离线播放、`m5-share.spec.ts` 迁移全流程、`latest.yml` 同版本更新检查及 `/S` 静默卸载清理。
- 尚未实测（保持未关闭）：（1）物理 Windows Explorer 图形界面双击 `.novelive` 文件关联唤起（本轮仅测命令行传参与单实例 `second-instance`）；（2）实际下载更高版本 NSIS 安装包并触发 `quitAndInstall` 重装覆盖（本轮仅测同版本 `0.0.0` `latest.yml` 查询）。
