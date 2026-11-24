# 06: 集成本地放大资源与创作端后处理

**Effort:** m3-playback
**Blocked by:** None
**Covers:** W3
**Files:** bin/upscale/, packages/creator/src/pipeline/postprocess/, tools/upscale/, tests/integration/m3-upscale.test.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts` → 以真实 ncnn 二进制和固定资产运行三模型，RGBA/尺寸/回填正确。

- [x] 固定官方二进制和权重及校验和；可重建 YandereNeo ncnn，保留三方许可。零模型调用，复用固定图片；检查基准与派生同档、失败不阻拦旧图回填。

## Progress

- 2026-11-23：三档模型、跨平台程序摘要及许可已落齐；在仓库外 venv 实跑 YandereNeo 转换（torch CPU 2.14.1、spandrel 0.4.2、pnnx 20261020，fp16=1）。权重含 param 共 20,331,593 字节（19.390 MiB），Linux 程序 11,976,752 字节（11.422 MiB），程序目录已忽略。
- 创作端提供临时文件/std​io 后处理、关闭/单次/双次、档位记录与差分检查、顺序回填 API；状态放在工程 `candidates/postprocess.json`，该目录不随作品导出，即使选择携带原文也不泄漏创作状态。不改 ArtProduction，接线留给 07；后台调用者负责工程写入调度。
- Check after: `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts --reporter=verbose` → `Test Files  1 passed (1)` / `Tests  7 passed (7)`；真实 binary 处理 RGB/RGBA，四倍输出检查、透明边缘、精确目标、WebP、双次等价、关闭不启动程序、差分模式/档位冲突、回填失败保留旧字节并继续、取消/错误/空列表通过。
- 实跑：Ubuntu 22.04，Intel Xeon 8 vCPU，Mesa lavapipe（安装 mesa-vulkan-drivers）；固定截图缩到 16×24，RGB+RGBA 每档合计 anime 6.023s、fast 0.949s、detail 4.405s，双次等价测试 1.883s。此小图集成检查不是 W3 的 1024px→2K P95 或安装包验收。
- `pnpm typecheck && pnpm lint` → exit 0；`Checked 243 files in 101ms. No fixes applied.` / `Found 1 info.`，唯一提示是已有 `tests/fixtures/text-models/build-synthetic.ts:63` 的 useTemplate，不在本任务范围，未修改。
- Review: 已自检范围与 diff；未运行界面视觉验收、Windows/macOS 程序或完整安装包验收。
- 复核修正：移除固定 `-t 32`，由 upscayl-bin 自动选择 tile size；lavapipe 无需固定 tile 即可通过。`NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts && pnpm typecheck && pnpm lint` → exit 0，`Test Files  1 passed (1)` / `Tests  7 passed (7)` / `Duration  12.63s (tests 99%)`；`Checked 243 files in 99ms. No fixes applied.` / `Found 1 info.`（同上既有 useTemplate 提示）。按后续指示将本任务合成一个提交并推送任务分支，不归档。
- 复核（2026-11-24，nl-01 worktree，Node v24.22.3）：`NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts` → `Test Files 1 passed (1)` / `Tests 8 passed (8)`，当前 main 上放大集成检查仍通过（上游合并后新增一例）。
- Review: pass (independent reviewer, 2026-11-24, window 01) — 独立只读审查核对 postprocess 与真实二进制集成测试；初轮对「已记录派生档位不一致被静默跳过」与「旧图先被覆盖再写档位」存疑，补充证据（同档约束由 backfill 写入路径保证、`variantProfile(base)` 写入时一致、`bad.webp` 失败保留旧字节已有测试覆盖、manifest 固定 URL+sha256、`tools/upscale/convert_yandereneo.py` 重建脚本与 `bin/upscale/licenses/` 存在）后裁定通过，无存活发现。
