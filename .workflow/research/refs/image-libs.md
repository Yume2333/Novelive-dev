# 图像生成/编辑 API 客户端库调研（OpenAI-compatible `/v1/images/*` 为主）

## Summary

市场上"专门封装 images API"的库几乎不存在有价值的第三选择：真正的候选只有两个——官方 `openai` SDK 和 Vercel AI SDK（`ai` + `@ai-sdk/openai` / `@ai-sdk/openai-compatible`）。其余 npm 上搜到的 image-generation 包均为小众 gateway/插件（`ottoport`、`dsh-image-plugins`、kie.ai 封装等，周下载量 <1.3k），直接排除。`@google/genai` 只覆盖 Gemini 自身 API，不解决 OpenAI-compatible 目标。

**结论先行：推荐 `openai` 官方 SDK（若未来要统一多 provider 的图像接口则选 AI SDK），不建议裸 fetch。** 原因：edits 端点的 multipart 上传（多图 `image[]` + `mask` + `markup`）、`stream: true` 时的 SSE 增量事件、以及 `moderation_blocked` 错误码的透传，openai-node 全部已正确实现且与 API spec 同步生成；自己重写需要复制约 200 行易错代码（FormData 字段顺序、SSE 解析、错误体保留），收益仅为省 ~24MB 未压缩体积（其中大头是 realtime/embeddings 等无关资源）。

## Files（证据锚点）

- `openai-node` `src/resources/images.ts` — `Images.generate`/`Images.edit`，类型：`ImageGenerateParams{Streaming,NonStreaming}`、`ImageEditParamsBase`（`image: Uploadable | Array<Uploadable>`，`mask?: Uploadable`，`markup?: Uploadable`，`partial_images`、`stream`、`background: 'transparent'|'opaque'|'auto'`、`size` 支持任意 `WIDTHxHEIGHT`（如 `1536x864`，16:9 可直接用）、`output_format`、`moderation?: 'low'|'auto'`、`input_fidelity`、`safety_identifier`）、`ImageGenStreamEvent = ImageGenPartialImageEvent | ImageGenCompletedEvent`。
- `openai-node` `src/core/error.ts` — `APIError` 暴露 `status / code / param / type / error / requestID`；按状态码分 `BadRequestError`(400) 等子类；`moderation_blocked` 通过 `err instanceof BadRequestError && err.code === 'moderation_blocked'` 精确识别。
- `openai-node` `src/client.ts` — 构造项 `baseURL`、`timeout`(默认10min)、`maxRetries`(默认2)、`fetch`、`fetchOptions`（可传 undici dispatcher）；`Uploadable` 支持 `fs.createReadStream` / `Blob` / `File` / `ArrayBuffer` / `Uint8Array`。
- `vercel/ai` `packages/openai/src/image/openai-image-model.ts` — `OpenAIImageModel implements ImageModelV4`：`supportsFileInputs`/`supportsMaskInputs` 能力位、edits 走 `postFormDataToApi`+`convertToFormData`（`image: Blob[]`、`mask`、`markup`）、generations 走 `postJsonToApi`；`abortSignal` 贯穿。
- `packages/openai/src/image/openai-image-model-options.ts` — `OpenAIImageModelGenerationOptions`/`OpenAIImageModelEditOptions`（zod schema）：`quality/style/background/outputFormat/outputCompression/moderation/inputFidelity/markup/user/safetyIdentifier`。
- `packages/openai-compatible/src/image/openai-compatible-image-model.ts` — 通用 images 模型：同样支持 `/images/edits` multipart + mask；`supportsFileInputs/MaskInputs` 为 `undefined`（不声明能力）；**无 moderation/background 的具名选项**——但 providerOptions 整体原样展开进表单（`...args`），所以 `providerOptions: { openai: { background: 'transparent' } }` 可透传。
- `packages/openai/src/openai-error.ts` — 错误体解析只保留 `{message,type,param,code}`，抛出通用 `APICallError`，`code` 在 `data.error.code` 中可拿但不映射为专用错误类。
- npm registry：`openai@7.62.0`、`ai@7.0.177`、`@ai-sdk/openai@4.0.121`、`@ai-sdk/openai-compatible@3.0.93`、`@ai-sdk/google@4.0.122`（均 2026-11 活跃发布，Apache-2.0，Node ≥22，纯 ESM 或 dual；`ai`/`@ai-sdk/*` 为 `"type":"module"` + `sideEffects:false`）。

## Architecture

```
generate:
  POST {baseURL}/images/generations   (JSON; stream:true → SSE ImageGenStreamEvent)
edit:
  POST {baseURL}/images/edits         (multipart/form-data; image[] xN, mask, markup)
errors:
  HTTP 400 { error: { code: 'moderation_blocked', ... } } → openai: BadRequestError(code)
                                                        → ai-sdk: APICallError(data.error.code)
```

## 对比表

| 维度 | `openai` (7.62.0) | `ai` + `@ai-sdk/openai` (7.0.177 / 4.0.121) | `ai` + `@ai-sdk/openai-compatible` (3.0.93) | 自写 fetch wrapper |
|---|---|---|---|---|
| 维护 | 官方，按 OpenAPI spec 生成 | Vercel 官方，周更新 | 同上 | 自己 |
| ESM/Node | dual（`.mjs` 优先），Node ≥22 | 纯 ESM，Node ≥22 | 纯 ESM | 自由 |
| 自定义 baseURL | ✅ `baseURL` | ✅ `createOpenAI({baseURL})` | ✅ `createOpenAICompatible({baseURL, apiKey, headers, fetch})` | ✅ |
| 编辑：多参考图 | ✅ `image: Uploadable[]`（≤16） | ✅ `prompt.images[]`（≤16） | ✅ `files[]` | 手写 FormData |
| mask | ✅ `Uploadable` | ✅ `prompt.mask` | ✅ `mask`（声明能力=undefined） | 手写 |
| markup 覆盖图 | ✅ | ✅ `providerOptions.openai.markup` | ✅（透传） | 手写 |
| 透明背景 | ✅ `background:'transparent'` | ✅ `providerOptions.openai.background` | ✅（透传任意字段） | ✅ |
| size/任意 16:9 | ✅ `size:'1536x864'` | ⚠️ `size` 参数直通；`aspectRatio` 被 warning 后丢弃 | 同左 | ✅ |
| b64 vs url | b64（GPT-image 恒 b64）/旧模型 url | 自动转 `Uint8Array`/base64 | 同左 | ✅ |
| 流式 partial images | ✅ `stream:true` → `Stream<ImageGenStreamEvent>` | ❌ `generateImage` 一次性返回；无 partial 事件 | ❌ | 手写 SSE 解析 |
| AbortSignal | ✅（fetch 语义） | ✅ `abortSignal` | ✅ | ✅ |
| provider 参数透传 | ⚠️ 仅类型化参数；未知字段需 `body` 强转 | ✅ `providerOptions.openai.*`（zod 校验，白名单） | ✅ 任意键值展开进表单 | ✅ |
| 错误/moderation 检测 | ✅ 强类型 `BadRequestError`，`err.code==='moderation_blocked'` 直接可读 | ⚠️ `APICallError`，需 `err.data.error.code`（`OpenAIErrorData` 保留了 code） | 同左 | 自己解析 error body |
| 重试/超时 | ✅ `maxRetries:2` + `timeout:10min` + undici dispatcher 钩子 | ⚠️ 依赖 `fetch`，无内建重试 | 同左 | 自己写 |
| 体积/依赖 | ~24MB unpacked、4107 files；0 runtime deps（peers 全 optional） | `ai` 9MB + `@ai-sdk/openai` 3.7MB + `@ai-sdk/provider(-utils)`；依赖 zod peer | 同左但更小 | ~0 |
| 许可证 | Apache-2.0 | Apache-2.0 | Apache-2.0 | — |

## 关键证据细节

- `moderation_blocked`：OpenAI 返回 HTTP 400，`error.code='moderation_blocked'`（OpenAI 文档 + genace.ai 错误库证实）。openai-node `APIError` 把 `error.code` 复制到 `err.code`；AI SDK 的 `openaiErrorDataSchema` 也保留 `code`，但抛的是通用 `APICallError`，判别要写成 `err.data?.error?.code === 'moderation_blocked'`（[推测] AI SDK 无专用 ModerationError 类）。
- 任意 `WIDTHxHEIGHT`：`openai` SDK 类型已放开（`(string & {}) | '1024x1024'|...`），gpt-image-2.x 支持 `1536x864`（16:9）；AI SDK 的 `generateImage` 也把 `size` 原样传给 endpoint，两者都行。
- 流式：只有 `openai` SDK 暴露 `stream:true` + `partial_images` 的 SSE 事件流（`ImageGenPartialImageEvent`/`ImageEditPartialImageEvent`/`...CompletedEvent`）。Novelive 若要做"生成中实时预览"（art director 体验），这是 AI SDK 目前的硬性缺口（[推测] `generateImage` 无流式 API）。
- `@ai-sdk/openai-compatible` 的 `OpenAICompatibleImageModel` 会把 `providerOptions` 全部展开进 multipart/json body（`...args`），所以对第三方 OpenAI-compatible 端点（如自建 gateway、llmgateway）任意私有参数都能透传——这点甚至比 `@ai-sdk/openai` 的白名单 zod schema 灵活。
- Electron 环境：utility process 是 Node，`Uploadable` 可直接喂 `Buffer`/`fs.createReadStream`；AI SDK 的 `prompt.images` 接 `Buffer | Uint8Array | base64 | URL`（会自行 `downloadBlob` 拉远程图）。

## 对 Novelive 的启示

1. **采用 `openai` SDK 作为图像调用层**，而非 AI SDK：唯一同时覆盖"多参考图 edits + mask/markup + 透明背景 + 任意 size + partial-image 流式 + `moderation_blocked` 精确错误码"的选项；`stream:true` 的 SSE 对"边生成边展示进度"的 visual-novel 体验是硬需求，AI SDK `generateImage` 没有对应 API。
2. **不要用裸 fetch**：edits 的 multipart 字段（`image[]` 多文件、mask 需与首图同尺寸的透明 PNG、markup 互斥规则）+ SSE 解析 + 错误体保留，自己实现约需复刻 openai-node `multipartFormRequestOptions`/`Stream` 的逻辑，省下的体积不值得承担 spec 漂移风险。
3. **`moderation_blocked` 检测模式**：`catch (e) { if (e instanceof APIError && e.code === 'moderation_blocked') → 映射为"内容审查拒绝"供 director/reviewer 角色重试或改 prompt }`；同时读 `err.error` 里的 `moderation_details`（若返回）记录到创作日志。
4. **baseURL/代理场景零障碍**：`new OpenAI({ baseURL, apiKey })` 即指向任意 OpenAI-compatible 端点；`maxRetries`/`timeout`（默认10min，适合高延迟图像生成）/`fetchOptions.dispatcher`（undici Agent 加长 bodyTimeout）都已内建。
5. **透明背景**：`background:'transparent'` + `output_format:'png'|'webp'` 组合在 SDK 类型里已写明约束（注释要求 transparent 必须配 png/webp），封装时在工具 schema 里把这三个字段做成关联校验，避免 director 角色传非法组合。
6. **若未来要接 Gemini/非 OpenAI 图像模型**：可并行引入 `ai` + `@ai-sdk/google`（或 `@google/genai`），但只用作"非 OpenAI provider 适配器"；OpenAI-compatible 主线仍走 `openai` SDK——混用两个抽象层比强行统一更省事，因为 AI SDK 的流式缺失正好卡在需求上。
7. **多参考图编辑**（角色一致性：角色立绘 + 场景参考 + 风格图）：`images.edit({ image: [buf1, buf2, ...] })` 支持 ≤16 图、`input_fidelity:'high'` 保脸部一致性——这直接映射到 Novelive "保持一致角色形象" 的工具设计。
8. **体积代价可控**：`openai` 包 unpacked ~24MB 但 Electron 后端进程对包大小不敏感（非 bundle 到前端）；若介意可在打包时仅 ship `dist/`。AI SDK 方案反而需要 `ai + @ai-sdk/provider + @ai-sdk/provider-utils + zod` 一串依赖。
9. **避免**：`@ai-sdk/openai-compatible` 的 imageModel 虽支持 edits+mask，但 `supportsFileInputs/supportsMaskInputs` 声明为 `undefined` 且无流式，仅适合作为"第三方兼容端点"的备选路径，不应作为主抽象。