# 09: 构建并实测 Windows 安装包

**Effort:** m5-delivery
**Blocked by:** 06, 07
**Covers:** W3
**Files:** .workflow/evidence/m5/windows/
**Read first:** `.workflow/specs/m5-delivery.md`、`docs/architecture.md` 自动更新。
**Check:** `pnpm --filter @novelive/desktop run package:windows` → 实际安装 NSIS 包，双击作品包离线播放，验证 NSIS 更新和卸载。
**Base commit:** 1ac35cb0eaeb78c10355c00473a7112f00e7fb2c

- [x] 在 Windows 记录运行环境、产物版本/校验和/获取位置及流程回执，不提交二进制。

## Progress

- 已在 CI 原生 `windows-2025-vs2026`（Windows Server 2025 Datacenter `10.0.26100`）跑通（[Native packages #45556159242](https://github.com/Yume2333/Novelive-dev/actions/runs/45556159242)，commit `1ac35cb0eaeb78c10355c00473a7112f00e7fb2c`，回执见 [Windows](../../evidence/m5/windows/README.md)）：`package:windows` 输出 NSIS 安装包与 `latest.yml` 并通过 `SHA256SUMS` / SHA-512 校验；完成 `/S /D=...` 静默安装、`HKCU` `.novelive` 注册表关联与 ProgID 检查、许可文件检查、已安装 `Novelive.exe` 导入 `.novelive` 删包离线播放、`m5-share.spec.ts` 迁移全流程、`latest.yml` 同版本更新检查及 `/S` 静默卸载清理。
- 尚未实测（保持未关闭）：（1）物理 Windows Explorer 图形界面双击 `.novelive` 文件关联唤起（本轮仅测命令行传参与单实例 `second-instance`）；（2）实际下载更高版本 NSIS 安装包并触发 `quitAndInstall` 重装覆盖（本轮仅测同版本 `0.0.0` `latest.yml` 查询）。
- Check after: CI `windows-2025-vs2026` run `45556159242` 上 `package:windows` exit 0，NSIS SHA-256 `0cce42ff41137ec2b7dd386c36d3345b46164125344fd929a5a134788a71d8e4`，静默安装/卸载、关联、离线播放、同版本更新检查通过（见 [Windows](../../evidence/m5/windows/README.md)）。
- Check waived: 物理 Explorer 双击与更高版本 NSIS `quitAndInstall` 覆盖安装不再实测；所有者；2026-11-26
- Review: skipped — 所有者 2026-11-26 指示免除物理真机项并直接通过；只含证据文件。
