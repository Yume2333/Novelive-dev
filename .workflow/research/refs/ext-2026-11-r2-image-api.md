# R2 调研：OpenAI 兼容图片接口（/v1/images/*）生态与 draw_image 适配层设计

调研日期 2026-11-21。任务要求：核实 OpenAI 自家图片模型现状、枚举走 OpenAI 兼容图片协议的模型/端点及参数兼容度、给出兼容性矩阵与适配层设计。证据以 openai npm SDK 7.62.0 类型定义（与 OpenAPI spec 同步生成）、各 provider 官方文档、new-api 中转源码（commit `8542c9d`）为准；打 `[INFERENCE]` 的为未实测推断。

## 1. 结论（≤15 行）

1. **OpenAI 图片线已换代**：`gpt-image-1` 已于 2026-10-23 关闭；当前在售 `gpt-image-1.5 / gpt-image-2 / gpt-image-2.5-{sunburst,flare} / gpt-image-2.6-{sunburst,flare}`。2.5/2.6 代支持任意 `WxH` 尺寸（两边 16 的倍数、宽高比 1:3–3:1、上限 3840×2160、>2560×1440 为实验性）、`background:transparent`、`input_fidelity`（仅 1.5 有 high）、edits 最多 16 张参考图、`output_format`（png/webp/jpeg/gif/svg）、`output_compression`、`moderation`、`stream+partial_images(0–3)`、`complexity`(2.6)、`markup`(2.5/2.6)。`response_format` 已弃用，GPT Image 恒返回 `b64_json`。
2. **“OpenAI 兼容图片接口”实际有两个方言**：(a) `/v1/images/generations`（JSON）+ `/v1/images/edits`（multipart）——OpenAI、火山方舟 Seedream、阿里 Qwen-Image（兼容模式）、SiliconFlow、Together、new-api/one-api 系中转；(b) OpenRouter 自有 `POST /api/v1/images`（字段 `input_references/resolution/aspect_ratio`，参数归一化最好、有 per-endpoint 能力清单但**不是** OpenAI 形状）。fal.ai 无 OpenAI 兼容图片端点。
3. **edits 是最大坑**：官方 SDK `images.edit` **永远发 multipart**；第三方里只有 OpenRouter 系中转（new-api 的 openai 通道/插件协议）和部分商业中转（七牛、Zenlayer 等）接 multipart edits。Seedream 图生图走 `generations` 的 `image` 字段（JSON 字符串/数组），Qwen 兼容模式同样把 `image` 放 `generations`、**明确不支持** `/images/edits`——这两家要靠“把 edits 请求翻译成 generations+image”的降级路径才能用。
4. **透明底**：OpenAI `background:transparent`、Seedream 5.5/`5.0 pro|flash`（`background` 参数，图生 RGBA 时 5.5 任意输入/5.0 限 1 张参考图且输入必须带 alpha）、Qwen-Image 2.1（按 prompt 自动决定 alpha）可直出；Gemini via Google compat **不支持**（无 background 参数，多余参数静默忽略）；Flux Kontext、SiliconFlow 全线**不支持**。
5. **拒绝/审核错误形状分裂**：OpenAI `400 + error.code=moderation_blocked`（`error.type=image_generation_user_error`，可带 `moderation_details{stage,categories}`）；火山 `400 + error.code ∈ {Input|Output}{Text|Image}SensitiveContentDetected[.子码]`；Qwen `400 + error{type:"invalid_request_error",code:"InvalidParameter"}`（文档列的错误码不含独立审核码，[INFERENCE] 内容拒绝混在 4xx 文案里）；SiliconFlow `422`（safety checker）或 `{code:int,message:string}`；Together `422`；OpenRouter `4xx/502 + error{code:int,message:string}`，审核拒绝归并进 provider error。
6. **url vs b64**：OpenAI 恒 b64；Seedream/Qwen/Together 默认 url（24h/1h 过期），需主动传 `response_format=b64_json`（Qwen 仅 3.0 系支持 b64）或在适配层下载 url；SiliconFlow 只回 `images[].url`（非 OpenAI 形状，1h 过期）——必须下载归一。
7. **尺寸语义分裂**：OpenAI 任意 `WxH`；Seedream 接受 `"2K"` 档位或像素值但有总像素区间（4.0: 921600–16777216）；Qwen `WxH` 像素面积 512²–2048²；SiliconFlow 字段名是 `image_size` 且枚举值有限；OpenRouter 用 `resolution`+`aspect_ratio`。**适配层必须做 size 归一化/吸附，不能把请求值原样外发**。
8. **适配层设计**（对应“能力不做检测”决策）：不做能力探测；用户在设置页除地址/Key/模型名外需回答四个声明性问题——「此端点是否兼容 OpenAI images 协议」（兼容 `/v1/images/*` vs 其他形状直接判不适用）、「支持图片编辑（多参考图）吗」「能输出透明底吗」「尺寸怎么填（任意 WxH / 分辨率档位 / 固定枚举）」。设置页三项能力测试（已定决策）实测验证用户声明。适配层归一化：url→下载字节、size 吸附、多参考图 edits→generations+image 降级（带警告）、缺 alpha→技术检查拦下、审核拒绝按上表错误码集合分类。
9. **推荐接法**：主链路 `openai` SDK + `baseURL` 自定义；对非 OpenAI 原生端点在适配层内做参数翻译后仍走 `images.generate`/`images.edit`（SDK 不限制字段）。编辑降级路径绕过 SDK multipart——用 `client.post('/images/generations', {body:{..., image:[b64...]}})`（SDK 支持自定义 body 或 `fetch` 直发）。OpenRouter 不值得为 v1 接（形状不同+能力清单 API 是另一个规范）。

## 2. 证据

### A. OpenAI 自家图片模型（openai npm SDK 7.62.0 `resources/images.d.ts`，Apache-2.0，2026-11-21 拉取）

- **模型枚举** `ImageModel`（`images.d.ts:326`）：`gpt-image-1.5 / gpt-image-2(-2026-04-21) / gpt-image-2.5-sunburst(-2026-09-08) / gpt-image-2.5-flare(-2026-09-08) / gpt-image-2.6-sunburst / gpt-image-2.6-flare / gpt-image-1 / gpt-image-1-mini / chatgpt-image-latest / dall-e-2 / dall-e-3`。注释明确：“`gpt-image-1` was shut down on October 23, 2026”。
- **generate 参数**（`ImageGenerateParamsBase`，`images.d.ts:679-820`）：`prompt`(≤32000 字符)、`background:transparent|opaque|auto`、`complexity:low|medium|high`、`frame_count/frame_duration_ms`(GIF)、`moderation:low|auto`、`n:1-10`、`output_compression:0-100`(webp/jpeg)、`output_format:png|webp|jpeg|gif|svg`、`partial_images:0-3`、`quality:low|medium|high|xhigh|max|auto|standard|hd`、`safety_identifier`、`size`（任意 `WIDTHxHEIGHT`，两边 16 倍数，宽高比 1:3–3:1，max 3840×2160，>2560×1440 实验性）、`stream`、`style`(deprecated)、`svg`、`user`(deprecated)。
- **edit 参数**（`ImageEditParamsBase`，`images.d.ts:471-660`）：`image: Uploadable|Uploadable[]`（≤16 张，每张 ≤50MB，png/webp/jpg）、`input_fidelity:high|low`（`gpt-image-1.5` 支持 high，`gpt-image-1-mini` 仅 low，`gpt-image-2` 应省略）、`markup`（透明 PNG 覆盖图，GPT Image 2.5+，与 mask 互斥）、`mask`（≤4MB，与首图同尺寸）、`prompt`、`background`、`complexity`、`n`、`output_*`、`partial_images`、`quality`、`size`、`stream`、`safety_identifier`、`svg`。无 `moderation` 字段（编辑复用生成侧审核）。`response_format` deprecated：“Unsupported for GPT image models, which always return base64-encoded images”。
- **响应**（`ImagesResponse`，`images.d.ts:330-435`）：`created`、`data[]{b64_json,url,revised_prompt}`、`background/output_format/quality/size` 回显、`usage{input_tokens,output_tokens,total_tokens,input_tokens_details{image_tokens,text_tokens},output_tokens_details}`、`safety_identifier`。
- **流事件**：`ImageGenPartialImageEvent{type:"image_generation.partial_image",b64_json,partial_image_index,...}` 与 `ImageGenCompletedEvent{type:"image_generation.completed",b64_json,usage,...}`；编辑侧 `image_edit.partial_image/completed`（`images.d.ts:73-317`）。
- **请求格式**：`resources/images.js` 确认 `generate` 走 JSON、`edit` 走 `multipartFormRequestOptions`（恒 multipart）。
- **错误**：`core/error.d.ts` `APIError{status,headers,error,code,param,type,requestID}`，按状态码派生 `BadRequestError(400)` 等。
- **moderation_blocked**：OpenAI 官方指南（`developers.openai.com/api/docs/guides/image-generation`，2026-11-21 读取）：`400 + error{type:"image_generation_user_error",code:"moderation_blocked",moderation_details:{moderation_stage:input|output|unknown,categories:[harassment|self-harm|sexual|violence...]}}`；`moderation:low` 可降敏感度。
- **定价**（`developers.openai.com/api/docs/pricing`，2026-11-21）：`gpt-image-2.6/2.5/2` 图像 input $8/1M tokens、output $30/1M、cached $2/1M；`gpt-image-1.5` $8/$32；`gpt-image-1-mini` $2.50/$8；Batch 半价。第三方测算（mxchat、datastudios、mockingbird，2026-11 上旬）：2.6 high 1536×1024 约 $0.041–0.042/张，low 档 2.6 比 2.5 贵 3–4 倍；单张按 output token 计（尺寸×质量映射 token）。

### B. 火山方舟 Seedream（`docs.volcengine.com/docs/ark/image-generation-api?lang=zh`，2026-11-21 读取）

- **端点**：`POST {ark}/api/v3/images/generations`；new-api 适配器证实**图生图也走 generations**（`relay/channel/volcengine/adaptor.go:267-269` 注释“豆包的图生图也走generations接口”，edits 分支整段注释掉），即**没有 `/api/v3/images/edits`**。
- **模型**：Seedream 5.5（新）、5.0 pro/flash/lite、4.5、4.0。
- **参数**：`model`、`prompt`（中文≤300 字/英文≤600 词建议）、`image:string|string[]`（URL 或 `data:image/...;base64,...`；5.5/5.0 pro/flash ≤10 张，5.0 lite/4.5/4.0 ≤14 张；单图 ≤30MB、宽高比 1/16–16、总像素 ≤36M）、`size`（`1K|1.5K|2K` 档位或 `WxH`；4.0 像素区间 1280×720–4096×4096、5.0 lite/4.5 为 2560×1440 起、5.5/5.0 为 921600–4624220，宽高比 1/16–16）、`output_format:png|jpeg`（jpeg+transparent 报错）、`background:auto|transparent|opaque`（仅 5.5、5.0 pro/flash；5.5 文生/图生 RGBA 都行，5.0 pro/flash 图生 RGBA **输入必须已带 alpha 且仅 1 张参考图**）、`response_format:url|b64_json`（默认 url，24h 过期）、`stream`（仅 5.0 lite/4.5/4.0，SSE）、`watermark`（默认 true，“AI 生成”水印）、`sequential_image_generation`（组图，≤15 张）、`optimize_prompt_options.mode`、`tools.web_search`（5.0 lite）、`layer_decomposition`（5.5/5.0 pro/flash 图层拆分，≤99/16 层）、`safety_identifier`。
- **响应**：`created`、`model`、`data[]{url|b64_json,size,output_format,background,[error]}`、`usage{generated_images,input_images,output_tokens(=Σ长×宽/256),total_tokens}`。
- **错误**：400 `BadRequest` + `error.code`（`docs.volcengine.com/docs/82379/1299023`）：`SensitiveContentDetected[.SevereViolation|.Violence]`、`Input{Text,Image,Video,Audio}SensitiveContentDetected[.PolicyViolation|.PrivacyInformation]`、`Output{Text,Image,Video,Audio}SensitiveContentDetected[.PolicyViolation|.DeepFake]`、`Input{Text,Image}RiskDetection`、`Output{Text,Image}RiskDetection`、参数类 `InvalidParameter[.UnsupportedParameter|.TaskTypeConstraint]`、`MissingParameter`、`InvalidImageURL.*`；429 `RateLimitExceeded.*`（含 `ModelAccountIpmRateLimitExceeded`）、`ServerOverloaded`；500/503 瞬态。

### C. 阿里百炼 Qwen-Image（`alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference`，2026-11-20 更新，2026-11-21 读取）

- **端点**：`POST {workspace}.{region}.maas.aliyuncs.com/compatible-mode/v1/images/generations`（JSON，同步）。**官方明示**：兼容模式把文生图和图生图**合并**在此端点——省 `image` 即 T2I、传 `image` 即 I2I；**不支持** `/images/edits`、multipart、mask、异步、流式、partial。
- **模型**：`qwen-image-3.0-pro / 3.0 / 2.1-pro / 2.1-turbo`。3.0 系 I2I ≤3 张参考图，2.1 系 ≤10 张；2.1 系可按 prompt 自动输出透明通道图（“automatically decide whether to output ... transparent (alpha) channel based on the prompt description”）。
- **参数**（全在顶层平铺）：`model`、`prompt`（≤4500 tokens）、`image:string|string[]`（URL 或 base64 data URL，JPG/PNG/BMP/TIFF/WEBP/GIF，≤10MB，边长 1–8000、长宽比 ≤10:1）、`n:1-6`、`size:WxH|auto`（T2I 与 I2I 总像素 512×512–2048×2048，宽高比 1:8–8:1；注意分隔符是 `x`，DashScope 原生协议用 `*`）、`response_format:url|b64_json`（**b64 仅 3.0 系同步调用支持**；默认 url 24h 过期）、`negative_prompt`（仅 3.0 系）、`seed`、`prompt_extend`(默认 true)、`prompt_extend_mode:direct|agent`（agent 仅 T2I）、`enable_thinking`、`watermark`(默认 false)。扩展字段经 `extra_body` 传入。
- **响应**：`created`、`data[]{url|b64_json}`、`usage{output_width,output_height,input_image_count,input_image_type,output_image_count,output_image_type}`（3.0）或 `{image_count,width,height}`（2.1）；**无 request_id 于 body**，在 `x-request-id` 头。
- **错误**：`error{message,type:"invalid_request_error",param,code}`（例 `InvalidParameter`）；错误码页未单列图片审核码——[INFERENCE] 内容审核与参数错误共用 4xx 形状，需按 message/code 关键字再分类。

### D. Google Gemini OpenAI-compat（`ai.google.dev/gemini-api/docs/openai`，2026-11-21 读取）

- **端点**：`POST generativelanguage.googleapis.com/v1beta/openai/images/generations`（JSON）。文档列的生图模型 `gemini-2.5-flash-image / gemini-3-pro-image-preview`。
- **支持的参数**：`prompt, model, n, size, response_format`；**其余未列参数被兼容层静默忽略**。`extra_body` 可加 `aspect_ratio`（"16:9" 等）、`generation_config{responseModalities,candidateCount}`、`safety_settings`、`tools.google_search`（仅 3-pro-image）。
- **无** `/v1beta/openai/images/edits`（文档无此节）；**无** `background`/透明底参数；`size` 文档未列取值集（按 aspect_ratio 映射）。`response_format:b64_json` 可拿内联字节。
- **错误**：OpenAI 形状 `{error:{message,type,param,code}}`（同 chat 兼容层）；内容拒绝走 Gemini `safety` 语义，兼容层映射为 4xx/200-with-finishReason 的具体形状未在文档明确——[INFERENCE] 常见为 `400 + error.code`（如 `content_filtered`）或 200 空图。
- **new-api 的 gemini 通道**（`relay/channel/gemini/adaptor.go:68-131`）：`ConvertImageRequest` **只接受 `imagen*` 模型**（Vertex Imagen，非 Nano Banana），把 `size` 翻成 `aspectRatio`（`1024x1024→1:1`、`1536x1024→3:2`、`1792x1024→16:9`…）、`quality` 翻成 `imageSize`（hd/high/2K→2K，其余→1K），`PersonGeneration:"allow_adult"` 硬编码。说明第三方中转对 Gemini 的 images 协议映射是**自己翻译的**，与 Google 官方 compat 层不同。

### E. OpenRouter（`openrouter.ai/docs/features/multimodal/image-generation` + `/api-reference/images/generate-an-image`，2026-11-21 读取）

- **端点**：`POST openrouter.ai/api/v1/images`（**不是** `/v1/images/generations`，openai SDK 的 `baseURL` 直接指不过去——SDK 会拼成 `/api/v1/images/generations`，需适配层自写 fetch）。JSON，可 `stream:true`。
- **归一化参数**：`model`（`provider/slug` 形如 `bytedance-seed/seedream-4.5`、`openai/gpt-image-2`、`google/gemini-2.5-flash-image`、`black-forest-labs/flux-3-image`）、`prompt`、`n:1-10`、`resolution:512|768|1K|1.5K|2K|4K`、`aspect_ratio`（枚举 1:1–21:9+auto）、`size`（档位或 `WxH`，provider 决定接不接像素值）、`quality:auto|low|medium|high|xhigh|max`、`output_format:png|jpeg|webp|svg|gif`、`frame_count/frame_duration_ms`、`markup`、`background:auto|transparent|opaque`、`output_compression`、`seed`、`response_format:b64_json|url`（默认 b64；url 24h 过期，ZDR/流式时回落 b64）、`input_references[]`（`{type:"image_url",image_url:{url}}` 含 data URL，≤16）、`stream`、`user`、`provider{only,order,ignore,sort,allow_fallbacks,zdr,data_collection,options{slug:{passthrough}}}`。
- **能力发现**：`GET /api/v1/images/models` 返回每模型 `supported_parameters`（enum/range/boolean 描述符）、`supports_streaming`、`endpoints` URL；`/endpoints` 返回 per-provider `supported_parameters`、`allowed_passthrough_parameters`、`pricing[{billable,unit,cost_usd,variant}]`。
- **响应**：`{created,data[{b64_json,media_type,url?,layer?}],expires_at?,usage{prompt_tokens,completion_tokens,total_tokens,cost}}`；SSE 事件 `image_generation.partial_image/.completed` + `error`。
- **错误**：HTTP 400/401/402/403/404/413/429/500/502/524/529，`error{code:int,message:string}`；计费 all-or-nothing，失败返回 502；内容拒绝未单列码（归入 400/502 provider error）。[INFERENCE] provider 审核拒绝会透传上游 message。

### F. SiliconFlow（`docs.siliconflow.com/en/api-reference/images/images-generations`，OpenAPI 内嵌，2026-11-21 读取）

- **端点**：`POST api.siliconflow.cn|com/v1/images/generations`（JSON）。oneOf 按模型分 schema：`FLUX.2-pro|FLUX.2-flex|Qwen-Image|Z-Image|FLUX.1-Kontext(-dev)|FLUX-1.1-pro(-Ultra)|FLUX.1-schnell|FLUX.1-dev`。
- **参数**：**`image_size`**（非 `size`；FLUX.2 枚举 `512x512/768x1024/1024x768/576x1024/1024x576`，Qwen-Image 推荐 `1328x1328/1664x928(16:9)/928x1664/1472x1140/1140x1472/1584x1056/1056x1584`，FLUX-1.1-pro 用 `width`+`height`（32 倍数，≤1440））、`batch_size:1-4`（非 `n`）、`seed`、`num_inference_steps`、`guidance_scale`/`cfg`、`negative_prompt`（Qwen/Z-Image/Ultra）、`prompt_upsampling|prompt_enhancement`、`safety_tolerance:0-6`（FLUX）、`image`/`input_image`/`image2`/`image3`（base64 data URL 参考图，Kontext/Qwen-Edit 必填）、`output_format:png|jpeg`、`image_prompt`（Ultra remix）、`aspect_ratio`（Kontext/Ultra 21:9–9:21）。
- **响应**：**`images[{url}]`**（非 `data[]`！）+ `timings.inference` + `seed`；url 仅 1h 有效。
- **错误**：`{code:int,message,data}`（400 `BadRquestData` 如 code 20012）、429 `{message,data}`、503 `OverloadedtData`、504 `TimeoutData`；safety checker 命中文档未单列码。
- **new-api 翻译**（`relay/channel/siliconflow/adaptor.go:39-62`）：`size→image_size`、`n→batch_size`，`image/image2/image3` 直通 `Extra`；返回仍按 OpenAI `data[]` 转写给客户端（new-api 自己归一）。

### G. Together AI（`docs.together.ai/reference/post-images-generations` + `inference/images/parameters`，2026-11-21 读取）

- **端点**：`POST api.together.ai/v1/images/generations`（JSON）。模型：`black-forest-labs/FLUX.2-{dev,pro,flex}|FLUX.1-{schnell,schnell-Free}|FLUX.1.1-pro|Kontext pro/max/dev`、Google Imagen/Gemini。
- **参数**：`prompt,model`、`width`+`height`（多数 FLUX，8 倍数）或 `aspect_ratio`（Kontext 系）——**无统一 `size`**、`steps`、`n:1-4`、`seed`、`negative_prompt`（部分模型）、`guidance_scale`、`response_format:base64|url`（**取值是 `base64` 不是 `b64_json`**；默认 url）、`output_format:jpeg|png`、`image_url`（Kontext 编辑）、`reference_images[]`（URL，FLUX.2/Google）、`disable_safety_checker`（默认 false；schnell-Free/Pro 不跑 checker）。
- **响应**：`{id,model,object:"list",data[{index,b64_json|url,type,timings}]}`。
- **错误**：safety checker 命中返回 **422 Unprocessable Entity**；参数错 400；429/5xx 常规。

### H. new-api / one-api 系中转（源码 `QuantumNous/new-api@8542c9d`，AGPL-3.0，2026-11-21 读取）

- **图片中继编排**：`relay/image_handler.go` `ImageHelper`——`dto.ImageRequest`（`openai_image.go:24-56`）平铺 OpenAI 字段+`Extra` 兜私有参数→`adaptor.ConvertImageRequest`→上游→`adaptor.DoResponse`。PassThrough 模式可原样转发 body。
- **multipart edits 归一**：`middleware/distributor.go:536-545`：`/v1/images/generations` 缺省 model=`dall-e`；`/v1/images/edits` 按 `Content-Type` 为 form/multipart 时从表单取 `model` 字段。volcengine 适配器把 edits 也指向 `api/v3/images/generations`（被注释的 multipart 转发代码显示：曾经想把 `image`/`image[]`/`mask` 文件透传，已废弃改为 JSON）。
- **即梦/其他通道**：`relay/channel/jimeng/image.go` 把即梦原生 `binary_data_base64[]|image_urls[]` 响应映射为 `dto.ImageResponse.Data[]{B64Json|Url}`——第三方中转普遍把非 OpenAI 上游归一成 `data[]{url,b64_json}` 形状。
- **插件协议**：`pkg/jsplugin/routing.go:98-109` `ProtocolOpenAIImage` 声明 `/v1/images/generations`（JSON）与 `/v1/images/edits`（JSON+multipart）两个 host 操作，插件实现 `decodeRequest/render` 即可把任意上游（阿里任务插件等）包装成 OpenAI 形状——意味着**市面上的中转对 edits 的支持取决于该渠道插件实现**，不可靠。
- **错误翻译**：`service/error.go:87-139` `RelayErrorHandler` 把上游 body 解析为 `GeneralErrorResponse`（`{error:{message,type,param,code}}` 或扁平 `message/msg/err/error_msg/header.message/response.error.message/detail`），优先 `TryToOpenAIError` 转 `error.code` 透传；`relaykit/types/error.go:42` 定义 `sensitive_words_detected` 内部码。即**中转一般透传上游 `error.code`/`error.message`，不会把审核拒绝归一成 `moderation_blocked`**。
- **SiliconFlow 翻译**：`size→image_size`、`n→batch_size`（`adaptor.go:52-57`）；`SFImageRequest` 有 `image/image2/image3` 私有字段透传（`dto.go`）。
- **Gemini（new-api）**：仅 `imagen*`；size→aspectRatio、quality→imageSize（`adaptor.go:68-131`）。
- **Volcengine**：generations JSON 直通，edits→generations（`adaptor.go:110-113,267-269`）。
- **流式**：`relay/channel/openai/relay_image.go:122-258` 处理上游 SSE→重建 `event:`/`data:` 帧；`isOpenAIImageStreamErrorEvent` 以 `type:error|upstream_error` 或非空 `error` 字段判错。
- **用量归一**：`normalizeOpenAIUsage` 把 `input_tokens/output_tokens/input_tokens_details` 映到 prompt/completion 计费字段。
- **计费张数**：`MaxImageN=128`；`openaiImageResponseCount` 按 `data[]` 里带 `url|b64_json` 的条目计。
- **许可证**：AGPL-3.0（`LICENSE` 首行确认）——与 Novelive AGPL-3.0 兼容，可移植改写；不拷文件级代码则无传染问题。

### I. fal.ai（`fal.ai` 文档，2026-11-21）

- 无 OpenAI 兼容图片端点；模型走 `fal.run/<endpoint-id>` 自有 schema + `fal` SDK。社区有第三方 falProxy（Deno，MIT）把 `fal` 包装成 `/v1/images/generations`。**v1 不接**。

## 3. 兼容矩阵

| 端点 | 协议路径 | T2I | 编辑（多参考图） | 透明底 | size 语义 | 返回 | 流式 | 审核/拒绝形状 |
|---|---|---|---|---|---|---|---|---|
| OpenAI gpt-image-2.5/2.6 | `/v1/images/generations`+`/edits`(multipart) | ✅ | ✅ ≤16 图、mask、markup、input_fidelity(1.5) | ✅ `background:transparent`(+png/webp) | 任意 `WxH`（16 倍数、1:3–3:1、≤3840×2160） | `data[].b64_json` 恒 | ✅ `stream`+`partial_images` | `400 error.code=moderation_blocked`，`type=image_generation_user_error` |
| 火山 Seedream 5.5/5.0 | `/api/v3/images/generations` | ✅ | ✅ `image` ≤10 图（generations 上 i2i，无 edits 端点） | ✅ `background`（5.5 任意；5.0 pro/flash 图生需输入带 alpha 且仅 1 图） | `1K/1.5K/2K` 档或 `WxH`（总像素区间约束） | `data[].url`(默认,24h)/`b64_json` | ✅ `stream`（仅 lite/4.5/4.0） | `400 error.code∈{Input,Output}{Text,Image}SensitiveContentDetected.*` |
| 阿里 Qwen-Image（兼容模式） | `compatible-mode/v1/images/generations` | ✅ | ✅ `image` 1–10 图（2.1）/1–3 图（3.0），**无 edits** | ⚠️ 2.1 系按 prompt 自动出 alpha | `WxH`（像素 512²–2048²，比 1:8–8:1） | `data[].url`(默认,24h)/`b64_json`（仅 3.0） | ❌ | `400 error{type:invalid_request_error,code:InvalidParameter}`（[INFERENCE] 内容拒绝混同） |
| Google Gemini compat | `/v1beta/openai/images/generations` | ✅ | ❌ 无 edits（多图输入要走原生 generateContent） | ❌ | `size` 未列枚举；`extra_body.aspect_ratio` | `data[].b64_json` | ❌ | `{error:{code,message}}`（Gemini safety，[INFERENCE] 形状） |
| OpenRouter | `/api/v1/images`（非 OpenAI 形状） | ✅ | ✅ `input_references[]` ≤16 | ✅ `background`（有 alpha 的 provider 才生效） | `resolution` 档位+`aspect_ratio`，`size` 便捷 | `data[].b64_json`（默认）/`url`(24h)+`media_type` | ✅（OpenAI provider 原生流） | `400/502 error{code:int,message}` 统一 |
| SiliconFlow | `/v1/images/generations` | ✅ | ⚠️ `image`/`image2`/`image3` base64 字段（Kontext/Qwen-Edit 才接受） | ❌ | `image_size` 枚举；FLUX.1.1 用 `width`+`height` | **`images[].url`**（1h，非 `data[]`） | ❌ | `{code:int,message,data}`；safety 命中无单列码 |
| Together | `/v1/images/generations` | ✅ | ✅ `image_url`/`reference_images`（Kontext/FLUX.2/Google） | ❌ | `width`+`height` 或 `aspect_ratio`（按模型族） | `data[].url`（默认）/`b64_json`（`response_format:"base64"`） | ❌ | 422 safety checker |
| new-api/one-api 中转 | `/v1/images/generations`+`/edits` | ✅ | ⚠️ 看渠道：OpenAI 通道原样透传（含 multipart edits）；volc/ali 通道翻成 generations+image | 看上游 | 透传上游语义 | 归一为 `data[]{url,b64_json}` | 看渠道 | 透传上游 `error.code`/`message`（不统一为 moderation_blocked） |

## 4. 对照现有设计

| 发现 | 判定 | 证据/位置 |
|---|---|---|
| `openai` SDK 调 `/v1/images/*` + 自定义 baseURL | 已覆盖 | `docs/architecture.md:9`、`.workflow/research/refs/image-libs.md`（推荐 openai SDK、streaming、moderation_blocked 检测） |
| 透明底由图片模型直出、不抠图 | 已覆盖且与证据一致（OpenAI/Seedream/Qwen 可直出） | `docs/visuals.md:52`、`decisions.md:124-129` |
| 多参考图编辑≤16、透明底组合 png/webp、生成预览流、moderation_blocked 精确识别 | 已覆盖 | `docs/architecture.md:55`、`image-libs.md:11,45-49,63-69` |
| 设置页三项测试（文生图/透明底/编辑）+只提示不兜底 | 已覆盖（且与证据吻合：能力确实因 provider 而异） | `docs/visuals.md:63`、`decisions.md:528-534` |
| 审核拒绝→降敏改写一次再拒→占位图 | 已覆盖；**但错误码集合要扩展** | `docs/visuals.md:46`、`decisions.md:375-380`；火山 `SensitiveContentDetected.*`、Qwen `invalid_request_error`、OpenRouter `error{code,message}`、Together 422 不在现有 `moderation_blocked` 单一识别里 → **缺口**（见下） |
| `draw_image {prompt,negativePrompt?}` 两字段、代码填 size/background/refs/format | 已覆盖 | `.workflow/research/novelive-agent.md:108`、`agent-orchestration.md:20,123` |
| `negativePrompt` 实际只有 Qwen 3.0 系、SiliconFlow 部分模型、Together 部分 FLUX 接受；OpenAI/Seedream/Gemini 无此参 | **缺口**：`draw_image` schema 暴露了 `negativePrompt`，但主流 OpenAI 端点上该字段会被忽略（Gemini 静默丢弃、OpenAI 未定义）。建议：(a) 适配层把它拼进 prompt 尾部（"Avoid: ..."）对外发而非传参，或 (b) 保留字段、文档写明"部分端点忽略" | `novelive-agent.md:108`；Qwen `negative_prompt`、SiliconFlow `negative_prompt`、Together `negative_prompt` vs OpenAI/Seedream 无对应参数 |
| `size` 直接传 `WxH` | **缺口**：OpenAI/Qwen 可；Seedream 有像素区间约束（背景 1920×1080=2073600 在 4.0 范围内、立绘竖版 1024×1536=1572864 在 4.0 内但低于 5.0 lite 起点 3686400）；SiliconFlow 用 `image_size` 枚举（1664×928 是 16:9）；OpenRouter 用档位+宽高比 | `docs/visuals.md:61` 定 16:9 1920×1080 基准；各 provider 文档 |
| `b64_json` 假设（`character-consistency.md:8` “返回 b64_json”） | **缺口**：Seedream/Qwen/Together 默认返回 `url`（24h/1h 过期），SiliconFlow 只有 `images[].url`。适配层必须 (a) 优先请求 `response_format=b64_json`（Qwen 仅 3.0），(b) 兜底 `data[].url`/`images[].url` 下载归一 | `character-consistency.md:8`；各 provider 文档 |
| 编辑调用方式 | **缺口**：现有设计假设 `/v1/images/edits` multipart；Seedream/Qwen 无 edits 端点——需在适配层提供 “edits 降级为 generations+image 字段” 路径。SDK `images.edit` 恒 multipart，对这类端点要走 `images.generate`+`image`（extra_body） | `architecture.md:55`（“多参考图编辑”）；volcengine `adaptor.go:267`；Qwen 文档“**不支持** `/images/edits`” |
| 流式预览 | **缺口**（低风险）：`architecture.md:55` 提了“生成预览流”；只有 OpenAI/OpenRouter/Seedream(lite/4.x) 支持 `stream`；Qwen/Gemini/SiliconFlow/Together 不支持。若适配层流式不可用时需明确回落同步 | `architecture.md:55` |
| 模型列表 | **缺口**：文档未记“默认模型 ID”；decisions `gpt-image-2.6-flare` 为开发默认（`decisions.md:546`）。设置页应给候选而非硬编码（模型换代快：gpt-image-1 已关闭） | `decisions.md:546` |
| 价格/用量字段 | 缺口（小）：OpenAI `usage{input_tokens,output_tokens}`、Seedream `usage{output_tokens}`、Qwen `usage{output_image_count,...}`、OpenRouter `usage.cost`——用量面板若做“按 provider 记用量”需归一到统一字段 | `docs/product.md:32`（用量统计面板） |
| `user`/`safety_identifier` | 已覆盖方向：桌面单用户应用无需填 | SDK 注释；可不传 |
| 审核拒绝 vs 临时错误区分 | **缺口**：现有 `moderation_blocked` 单一识别要扩展为分类集合：`{moderation_blocked}` ∪ `{Input|Output}{Text|Image}SensitiveContentDetected.*`（火山）∪ `{invalid_request_error+InvalidParameter & message 含敏感/审核}`（Qwen，需关键字匹配）∪ `422`（Together）∪ `{code:int & message 匹配}`（OpenRouter/SiliconFlow）。拒绝不消耗 `openai` SDK `maxRetries:2`（SDK 默认重试只针对 5xx/429/连接错，400 不重试——这点天然吻合，不用改） | `image-libs.md:55,65`；`decisions.md:605` |
| watermark | **缺口**：Seedream 默认 `watermark:true`（加“AI 生成”水印）、Qwen `watermark` 默认 false。适配层对 Seedream 应显式 `watermark:false` | 火山文档 `watermark` 字段 |
| `n` | 已覆盖：`draw_image` 一次一张（`novelive-agent.md:108`）；`n` 在各家都是 1–4/6/10 且我们不用 | — |

## 5. 可拷资产

| 资产 | 来源 | 许可证 | 大小 | 用途 |
|---|---|---|---|---|
| `openai` npm SDK 7.62.0 类型定义（ImageGenerate/Edit params、StreamEvent、APIError） | `openai` 官方包（`registry.npmjs.org/openai/-/openai-7.62.0.tgz`） | Apache-2.0 | images.d.ts 880 行 | 直接依赖，已定 |
| new-api `relay/channel/volcengine/adaptor.go` 的 size/编辑路径判断（generations 复用 edits） | new-api@`8542c9d` | AGPL-3.0 | ~80 行相关段 | 移植改写：volc/Qwen 系“edits→generations+image”降级 |
| new-api `relay/channel/gemini/adaptor.go` 的 `size→aspectRatio` 映射表 | 同上 | AGPL-3.0 | ~40 行 | 移植改写：Gemini compat/OpenRouter 系 size 翻译 |
| new-api `relay/channel/siliconflow/adaptor.go` `size→image_size`、`n→batch_size` | 同上 | AGPL-3.0 | ~20 行 | 移植改写：SiliconFlow 形状归一 |
| new-api `service/error.go` `RelayErrorHandler` 的错误体解析顺序（error 对象→TryToOpenAIError→扁平 message/msg/err/error_msg/header/response） | 同上 | AGPL-3.0 | ~50 行 | 移植改写：多 provider 错误体归一化 |
| OpenRouter `supported_parameters` capability-descriptor 设计（enum/range/boolean） | `openrouter.ai` 文档 | 文档（CC 未标注；只参考形状） | — | 只参考：我们不做能力检测，但其“每端点显式声明能力”的思路正好对应“让用户在设置页声明” |
| 中转错误关键字清单（moderation_blocked / SensitiveContentDetected / invalid_request_error / 422） | 本报告 §2B/C/E/G | — | — | 写进适配层 `isContentRefusal(err)` |

## 6. 适配层设计建议（对应“能力不做检测”，改成“用户声明 + 设置页三项测试”）

### 6.1 设置页需要用户回答的声明

不做能力探测，但**需要用户在图片模型配置里除 `baseURL/model/API Key` 外多选 4 个声明**（默认值给“OpenAI 官方”预设，自定义地址时显示）：

1. **协议形状**（单选）：`OpenAI images 协议`（`/v1/images/generations`+`/edits`，默认）/ `OpenRouter 专用`（`/api/v1/images`，v1 标“暂不支持”）。— 若用户填的是 OpenRouter，直接提示“该端点不是 OpenAI images 协议，暂不支持”，不进适配层。
2. **图片编辑**：`支持（多参考图）` / `仅文生图` / `不确定`。决定差分派生走哪条路径——“仅文生图”时设置页第三项测试必然失败，用户据此换模型（已定决策：不兜底）。
3. **透明底**：`支持` / `不支持` / `不确定`。
4. **尺寸**：`任意 WxH`（默认）/ `分辨率档位`（Seedream `1K|2K` 等）/ `固定枚举`（SiliconFlow 等，附输入框让用户贴合法值）。

设置页三项测试（已定）作为“声明核对”：文生图小图→读尺寸/格式；透明底→读 alpha；编辑→用一张测试图+`image`/`edits` 跑通。三项结果与声明不符时给出矛盾提示（“声明支持透明底但返回图无 alpha”），不阻止保存。

### 6.2 适配层归一化（`draw_image` 内部）

```
Request（代码组装）
  ├─ mode: generate | edit
  ├─ prompt (画师给的 + 代码前缀的参考图角色声明句)
  ├─ refs: [{file, role}]              // 参考图
  ├─ target: {kind: portrait-9x16|bg-16x9|cg-16x9, wantAlpha}
  └─ profile: {sizeMode, editsMode, returnPref}  // 来自用户声明/预设

resolveProfile(baseURL, model):
  - host 匹配 openai.com|localhost → openai 预设（任意 WxH、edits multipart、恒 b64、stream 可用）
  - 含 volces.com|ark → seedream 预设（档位/WxH、无 edits、url 默认、watermark:false 必传）
  - 含 maas.aliyuncs.com|dashscope → qwen 预设（WxH、generations+image、url 默认、3.0 才 b64）
  - 含 generativelanguage → gemini-compat 预设（无 edits、无 transparent、extra_body.aspect_ratio、size 不通用）
  - 含 siliconflow → sf 预设（image_size 枚举、images[].url、无 edits）
  - 含 together → together 预设（width/height 或 aspect_ratio、response_format:"base64"、422 审核）
  - 其他 → openai-compatible 通用预设 + 用户声明修正
  （不做主动探测，host 匹配失败时全部回落到用户在 UI 的声明；host 匹配仅用于“省得用户填”）

调用：
  - editsMode=multipart → client.images.edit({image:[refs], prompt, size, background, output_format})
  - editsMode=generations-image → client.images.generate({prompt, size, background?, extra_body:{image:[refDataUrls]}})  // Seedream/Qwen/部分中转
  - editsMode=none → 差分/变体在调度侧就拦下（理论上设置页测试已提示）

返回归一：
  - data[].b64_json 有 → bytes
  - data[].url → fetch 下载（带 30s 超时、跟随重定向、记录 content-type）
  - images[].url（SiliconFlow）→ 同上
  - 无图 & 200 → 按技术检查失败处理（"空响应"）
  - stream=true 且 provider 支持 → 转发 partial_image 事件做预览；不支持 → 同步回落

后处理：
  - wantAlpha && 解码图无有效 alpha → 技术检查失败（视觉/技术检查已覆盖，`visuals.md:72`）
  - 尺寸不符（派生图≠基准图）→ 技术检查拦下（`visuals.md:70`）
  - watermark 提示：Seedream 默认加“AI 生成”水印→适配层恒传 `watermark:false`

错误分类（决定画师拿到什么）：
  - 内容拒绝（不重试 SDK 层）：status==400 && (error.code=="moderation_blocked" || error.code 匹配 /^(Input|Output)(Text|Image|Video|Audio)(SensitiveContentDetected|RiskDetection)/ || (error.type=="invalid_request_error" && /敏感|审核|sensitive|moderat|content.?polic|safety/i.test(error.message))) || status==422 && /safety|moderat/i.test(error.message) || error.message 匹配敏感词表
    → draw_image 返回 `{ok:false, kind:"content_refusal", stage?, categories?}`，工具走降敏改写流程（已定）
  - 用户错误（400 非审核）：`{kind:"bad_request", detail}`，日志+按临时错误处理但建议不重试
  - 限流/服务端（429/5xx/连接错）：`{kind:"transient"}`，SDK `maxRetries:2` 自己重试
  - 认证/配置（401/403/404）：`{kind:"config"}`，标"需要处理"，不重试
```

### 6.3 与现有文档的落点建议

- `docs/visuals.md` §3.1 或新增小节“图片接口适配”：写入上表兼容矩阵的精简版（哪些 provider 家族、各要什么参数形状）、用户需声明的 4 项、设置页测试与声明的关系。
- `docs/ux.md` 设置页段落：补 4 个声明字段 + 与三项测试的关系。
- `.workflow/research/novelive-agent.md` `draw_image` 段：补“编辑降级路径（generations+image）”“url→字节归一”“错误分类集合”三条实现要点。
- `docs/creation-pipeline.md` 图片模型设置段：补“协议形状/尺寸形态由用户在高级设置里声明”。

## 7. 需要所有者取舍的事

1. **是否支持 OpenRouter**：它有最完整的归一化（`input_references/aspect_ratio/resolution` + per-endpoint 能力清单 + Flux/Seedream/Gemini/OpenAI 全目录），但**不是** `/v1/images/*` 形状，需单独写 fetch 路径（`POST /api/v1/images`）。**建议 v1 不接**：OpenRouter 的模型目录通过其子代理访问，而国内用户主流是 new-api/one-api 中转 + 各家官方端点；接 OpenRouter 意味着第二条协议链和一套新错误形状，收益不抵复杂度。若日后要接，`provider.options` 机制能透传上游私有参数。
2. **`negativePrompt` 字段去留**：OpenAI/Seedream/Gemini 都不接受，只有 Qwen 3.0/SiliconFlow 部分/Together 部分接受。**建议保留 tool schema 字段但适配层默认把它拼进 prompt**（`Avoid: <negativePrompt>`），仅对声明支持 `negative_prompt` 的 provider 才作为参数外发——模型不用知道差异。
3. **流式预览要不要做**：`architecture.md:55` 已写“生成预览流”；但除 OpenAI/OpenRouter/Seedream-lite 外都不支持。**建议 v1 默认不开**（`stream:false`），适配层保留流接口但不暴露到 UI——美术导演看图清单时“边生成边显进度”价值有限，且只有 OpenAI 一家稳。
4. **Gemini compat 的地位**：Nano Banana（gemini-*.5-flash-image/pro-image）质量对二次元立绘不差，但 Google 官方 compat **不支持 edits、不支持 transparent**——对我们差分派生流程是硬缺口。**建议**：设置页允许填（用户可拿它画背景/CG），但在文档和 UI 上明示“Gemini compat 不支持编辑和透明底，不能做差分画师/立绘画师的图片模型”；如果用户主用它，编辑派生会走不通（设置页第三项测试会红）。
5. **Seedream 透明底的真实约束**：5.5 才支持任意文生 RGBA，5.0 pro/flash 图生 RGBA 要求输入图带 alpha 且限 1 张参考图。立绘流程（单基准图→表情差分）恰好是“1 张带 alpha 参考图 + 编辑”，**Seedream 5.0 pro/flash 可作为差分画师的备选**；但多参考图造型重画（设定图+旧造型 2 张）就不行。**建议**：profile 里加 `transparentEditMaxRefs` 字段（seedream-5.0=1, seedream-5.5=10, openai=16），超限时适配层退化为"只用首图+提示词补描述"。
6. **Qwen b64 限制**：`b64_json` 仅 qwen-image-3.0 系支持，2.1 系只回 url。适配层 url 下载归一化后这条无感；**建议** profile `returnPref:"b64|url|auto"`，Qwen-2.1 默认走 url 下载即可。
7. **用量统计字段归一**：`usage` 各家形状不同（OpenAI token 制、Seedream 张数+token、Qwen 张数+档位、OpenRouter `cost` 美元）。**建议**用量面板记 `{model, n_images, usage_raw}` 原样入库，展示层按模型家族格式化——不做强行统一。

## 附：本次未验证项

- 各 provider 的真实审核拒绝 HTTP body 样例（无付费调用，全部按文档/OpenAPI/SDK 类型推断；`[INFERENCE]` 标出）。
- Gemini compat 的 200-with-finishReason 型审核拒绝形状（文档未写）。
- new-api/one-api 系具体某个线上中转对 `background:transparent` 的透传保真度（取决于其渠道和版本）。
- Seedream 5.5 的 edits 端点是否会在后续版本开放（当前文档无）。
