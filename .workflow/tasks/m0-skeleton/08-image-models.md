# 08: 接通图片三项能力测试

**Effort:** m0-skeleton
**Blocked by:** 02, 03
**Covers:** W2, W3, W4
**Files:** packages/creator/src/models/image/, tests/unit/m0-image.test.ts, tests/fixtures/image-models/
**Read first:** `.workflow/specs/m0-skeleton.md`、`.workflow/research/handoff-defaults.md` M0、`docs/architecture.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/unit/m0-image.test.ts` → 三项能力独立执行，故障映射、透明度及五档尺寸通过。

- [ ] 适配 OpenAI 和 Seedream 的尺寸/质量/错误，并生成可经资源协议读取的缩略图。
- [ ] 404 编辑、400 尺寸、无 alpha 与 Seedream 参数错误用严格回放。
