# 06: 集成本地放大资源与创作端后处理

**Effort:** m3-playback
**Blocked by:** None
**Covers:** W3
**Files:** bin/upscale/, packages/creator/src/pipeline/postprocess/, tools/upscale/, tests/integration/m3-upscale.test.ts
**Read first:** `.workflow/specs/m3-playback.md`、`.workflow/research/handoff-defaults.md` 对应阶段、`docs/product.md`。
**Check:** `NL_REPLAY=strict pnpm exec vitest run tests/integration/m3-upscale.test.ts` → 以真实 ncnn 二进制和固定资产运行三模型，RGBA/尺寸/回填正确。

- [ ] 固定官方二进制和权重及校验和；可重建 YandereNeo ncnn，保留三方许可。零模型调用，复用固定图片；检查基准与派生同档、失败不阻拦旧图回填。
