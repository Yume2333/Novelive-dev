# M5 Windows 原生打包与实测验收

## 运行环境与 CI 来源

- **CI 运行：** [Native packages #45556159242](https://github.com/Yume2333/Novelive-dev/actions/runs/45556159242)（任务 `Package windows`，Job ID `139008599921`，状态 `completed` / `success`，耗时 8m53s：`2026-11-25T05:48:58Z` – `05:57:51Z`）
- **验证脚本：** `scripts/ci/verify-windows-package.ps1`、`tools/package/verify-artifacts.mjs win32`、`tests/e2e/m5-packaged.spec.ts`、`tests/e2e/m5-share.spec.ts`
- **被测提交（`headSha`）：** `1ac35cb0eaeb78c10355c00473a7112f00e7fb2c`（分支 `novelive-finish/07`；本文档与任务收口记录提交在后）
- **Runner 镜像与系统：** `windows-2025-vs2026`（镜像版本 `20261116.315.1`），`Microsoft Windows Server 2025 Datacenter`（版本 `10.0.26100`，Build `26100`，`X64`，PowerShell `7.6.10`）
- **构建与回放环境：** Node `24.22.3`、Electron `45.4.1`、`NL_REPLAY=strict`（0 付费 API 调用）

## 产物版本、校验和与获取位置

- **版本：** `Novelive 0.0.0`（未签名 NSIS 安装包，`Target: win32/x64`，`Host: win32/x64`）
- **保存位置：** GitHub Actions 运行 `45556159242` 的 Artifacts（保留 14 天，不提交二进制进 Git）：
  - 安装包与元数据：`novelive-windows-X64`（包含 `win32-x64-hXkNCz/artifacts/`）
  - 机器可读回执：`verification-windows-X64`（`windows-package-verification.json`）

| 产物文件名 | 大小（字节） | SHA-256 | `latest.yml` SHA-512（Base64） |
| --- | ---: | --- | --- |
| `Novelive-0.0.0-win-x64.exe` | `530,951,184` | `0cce42ff41137ec2b7dd386c36d3345b46164125344fd929a5a134788a71d8e4` | `IPp9fJ/tj02AhndkYQh/+jx1Q8ZXNN95e5fGQBsS1DjHA+IRmEg0EyA+tuq+W+PQg6KZLCRI4eHR/Z/kmBaw3Q==` |
| `Novelive-0.0.0-win-x64.exe.blockmap` | `552,211` | `e606f405e71993a9b88a204d1facc26eda4bd415f4035818505076d3ea24f33f` | — |
| `latest.yml` | `349` | `70e07a39cec9e796166d9b74e57eaf76dc87b5de0ad020349973539c1748a802` | — |

`BUILD.txt` 与 `SHA256SUMS` 已在 CI 及下载后本地 `sha256sum -c SHA256SUMS` 校验通过。

## 分步实测结果（`windows-package-verification.json`）

1. **`artifacts-and-checksums` — 通过：** 校验 `Novelive-0.0.0-win-x64.exe`（`v0.0.0`）、`latest.yml`（`version`、`path`、`sha512`、`files[0].size` 与安装包一致）及 3 条 `SHA256SUMS` 记录。
2. **`nsis-silent-install` — 通过：** 使用 `/S /D=D:\a\_temp\nl-win-install-6024-e8e8f7c2` 静默安装，退出码 `0`，确认 `Novelive.exe` 与 `Uninstall Novelive.exe` 落盘。
3. **`registry-file-association` — 通过：** 验证 NSIS 在 `HKCU` 写入 `.novelive` 文件关联与 ProgID `Novelive Work Package`，打开命令为 `D:\a\_temp\nl-win-install-6024-e8e8f7c2\Novelive.exe "%1"`，并记录卸载表项 `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\5210be89-6403-5cdb-8ba2-d3e09de6dd4b`。
4. **`install-licenses` — 通过：** 验证安装目录包含 `resources\licenses\LICENSE.txt`（`35,184` B）、`resources\licenses\THIRD_PARTY_NOTICES.txt`（`978,937` B）、`LICENSE.electron.txt` 及 `LICENSES.chromium.html`。
5. **`packaged-runtime-smoke` — 通过：**
   - `tests/e2e/m5-packaged.spec.ts`：启动已安装 `Novelive.exe`（临时 `--user-data-dir`、`NL_REPLAY=strict`、`NL_UPDATE_URL` 指向本地回环源）：`novelive:about` 返回 `{ version: "0.0.0", packaged: true }`；命令行传入 fixture `.novelive` 自动弹出导入确认并完成导入，删除源 `.novelive` 文件后仍可离线播放（对白文本及 Pixi 画布首像素 `[32, 48, 96]`）；本地 HTTP 源收到 2 次 `GET /latest.yml`（启动检查 + 设置页手动点击「检查更新」，提示「已是最新版本。」），0 次安装包下载。
   - `tests/e2e/m5-share.spec.ts`：针对已安装 `Novelive.exe` 完整跑通导出、导入、删包离线播放、第二实例传入 v2 作品包升级与存档迁移、导入为工程再导出。
6. **`nsis-silent-uninstall` — 通过：** 执行 `Uninstall Novelive.exe /S`（退出码 `0`）并等待 NSIS 后台清理完成，确认安装目录、`ProgID` 键、`OpenWithProgids` 值及卸载注册表项均已清除。

## 未在本轮原生实测的项（及原因）

- **真实 Windows Explorer 图形界面双击 `.novelive`：** 本轮通过 `Novelive.exe` 命令行参数与单实例 `second-instance` 拉起验证了文件关联路径处理，并静态校验了 `HKCU\Software\Classes` 注册表项；未在无交互 CI 中模拟桌面资源管理器双击。
- **代码签名与 Windows SmartScreen：** M5 刻意交付未签名安装包（`signExecutable: false`），未测签名验证与 SmartScreen 提示。
- **新版 NSIS 安装包在线下载并重启安装（`quitAndInstall`）：** 本轮仅在同版本 `0.0.0` 下验证了 `NsisUpdater` 请求并解析 `latest.yml`；未托管更高版本 `.exe` 以实际触发下载并重装覆盖。
- **安装包多语言 UI 切换实测：** 本轮运行在默认 `zh-CN` 界面下。
