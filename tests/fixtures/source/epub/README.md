# EPUB 合成用例

`tests/unit/m4-epub.test.ts` 使用已安装的 zip.js 在内存生成小型 EPUB，不含真书、私有数据或网络资源。正文、目录、NCX 与 2×2 SVG 均为合成内容；修改条目覆盖四级回退、同文件锚点、分卷、跨文件顺序、图片位置与错误输入。

视觉分类复用 `artJson` → `createReplayFetch`。`synthetic/` 包含三个固定 PNG 和纯本地 SSE 生成的合成 cassette，普通单元测试 strict 回放三个成功标签并禁止网络。这些不是供应商响应，也不证明模型视觉质量；固定 PNG 避免机器字体差异改变请求哈希。

真实供应商录制仅在协调者授权下进行，使用视觉槽规定的 `gemini-3.8-flash`。私有 cassette、原始响应与明细保存在 `$HOME/.local/novelive-epub-provider/`，不提交。公开回执见 `receipt.md`。私有成功回放命令：

```sh
NL_REPLAY=strict NL_EPUB_PROVIDER_MODE=strict pnpm exec vitest run tests/unit/m4-epub.test.ts -t 'EPUB classification provider driver'
```

录制模式先回放现有请求，只为缺档付费并追加。若确需替换旧响应，须经协调者重新授权并选择新的私有目录，而不是向同 key 重复录制。缺少完整输入/输出用量时继续保留 40000-token 预留，直到对账。

离线重建合成 cassette（不调用供应商，但重绘 PNG 的字体可能随主机变化；重新生成后须复核）：

```sh
NL_REPLAY=strict NL_EPUB_PROVIDER_MODE=synthetic pnpm exec vitest run tests/unit/m4-epub.test.ts -t 'EPUB classification provider driver'
```
