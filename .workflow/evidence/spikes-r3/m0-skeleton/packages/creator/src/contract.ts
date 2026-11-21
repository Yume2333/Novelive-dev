// @novelive/creator/contract — 命令、事件、帧的 pi-schema 定义。
// MessagePort（Electron）和 WebSocket（dev-bridge）共用同一份编解码。
import {
  arr,
  bool,
  compile,
  int,
  lit,
  num,
  obj,
  oneOf,
  opt,
  type Static,
  str,
  union,
} from "@earendil-works/pi-schema";

// ---------- 配置 ----------
export const ApiFormat = oneOf([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
] as const);
export type ApiFormat = Static<typeof ApiFormat>;

export const TextModelSlot = oneOf([
  "fast",
  "main",
  "writing",
  "visual",
] as const);
export type TextModelSlot = Static<typeof TextModelSlot>;
export const ModelSlot = oneOf([
  "fast",
  "main",
  "writing",
  "visual",
  "image",
] as const);
export type ModelSlot = Static<typeof ModelSlot>;

/** 界面上一个文本模型槽的可写字段；apiKey 用 •••• 哨兵语义（见 config.update） */
export const TextModelConfigIn = obj({
  apiFormat: ApiFormat,
  baseUrl: str(),
  model: str(),
  contextLength: int({ minimum: 0 }), // 0 = 未填，目录命中自动覆盖
  apiKey: str(),
  inheritFast: bool(),
});
export type TextModelConfigIn = Static<typeof TextModelConfigIn>;

export const ImageModelConfigIn = obj({
  baseUrl: str(),
  model: str(),
  apiKey: str(),
  concurrency: int({ minimum: 1, maximum: 32 }),
  retries: int({ minimum: 0, maximum: 10 }),
});
export type ImageModelConfigIn = Static<typeof ImageModelConfigIn>;

export const InterfaceConfigIn = obj({
  language: str(),
  theme: oneOf(["light", "dark", "system"] as const),
});
export type InterfaceConfigIn = Static<typeof InterfaceConfigIn>;

export const ProjectConfigIn = obj({
  defaultDir: str(),
});
export type ProjectConfigIn = Static<typeof ProjectConfigIn>;

/** config.get 返回的文本槽：API Key 换成掩码哨兵 */
export const API_KEY_MASK = "••••";

export const TextModelConfigOut = obj({
  apiFormat: ApiFormat,
  baseUrl: str(),
  model: str(),
  contextLength: int({ minimum: 0 }),
  contextSource: oneOf(["catalog", "manual", "none"] as const),
  apiKeyMasked: str(),
  apiKeySet: bool(),
  inheritFast: bool(),
});
export type TextModelConfigOut = Static<typeof TextModelConfigOut>;

export const ImageModelConfigOut = obj({
  baseUrl: str(),
  model: str(),
  apiKeyMasked: str(),
  apiKeySet: bool(),
  concurrency: int(),
  retries: int(),
});
export type ImageModelConfigOut = Static<typeof ImageModelConfigOut>;

export const AppConfigOut = obj({
  version: lit(1),
  models: obj({
    fast: TextModelConfigOut,
    main: TextModelConfigOut,
    writing: TextModelConfigOut,
    visual: TextModelConfigOut,
  }),
  image: ImageModelConfigOut,
  interface: InterfaceConfigIn,
  project: ProjectConfigIn,
});
export type AppConfigOut = Static<typeof AppConfigOut>;

// ---------- 错误 ----------
export const ErrorCode = oneOf([
  "network",
  "auth",
  "not_found",
  "invalid_config",
  "cancelled",
  "creator_down",
  "internal",
] as const);
export type ErrorCode = Static<typeof ErrorCode>;

// M0 命令词表：spec「M0 的命令」+ spec 要求的 node:sqlite / sharp 端到端冒烟入口
export const CommandName = oneOf([
  "config.get",
  "config.update",
  "model.testText",
  "model.testImage",
  "events.list",
  "debug.sqliteSmoke",
  "debug.sharpSmoke",
] as const);
export type CommandName = Static<typeof CommandName>;
export const CommandError = obj({ code: ErrorCode, message: str() });
export type CommandError = Static<typeof CommandError>;

// ---------- 命令 ----------
export const ConfigGetReq = obj({ scope: opt(str()) });
export const ConfigUpdateReq = obj({
  models: opt(
    obj({
      fast: opt(TextModelConfigIn),
      main: opt(TextModelConfigIn),
      writing: opt(TextModelConfigIn),
      visual: opt(TextModelConfigIn),
    }),
  ),
  image: opt(ImageModelConfigIn),
  interface: opt(InterfaceConfigIn),
  project: opt(ProjectConfigIn),
});
export type ConfigUpdateReq = Static<typeof ConfigUpdateReq>;

export const ModelTestTextReq = obj({ slot: TextModelSlot });
export type ModelTestTextReq = Static<typeof ModelTestTextReq>;

export const ModelTestImageReq = obj({});
export type ModelTestImageReq = Static<typeof ModelTestImageReq>;

export const EventsListReq = obj({
  scope: oneOf(["app", "work"] as const),
  scopeId: str(),
  afterSeq: int({ minimum: 0 }),
});
export type EventsListReq = Static<typeof EventsListReq>;

// ---------- 响应 ----------
export const TextTestResult = obj({
  ok: bool(),
  reply: opt(str()),
  model: opt(str()),
  latencyMs: opt(num()),
  error: opt(CommandError),
});
export type TextTestResult = Static<typeof TextTestResult>;

export const ImageCapResult = obj({
  state: oneOf(["ok", "unsupported", "fail", "skipped"] as const),
  thumbnailPath: opt(str()), // 相对缓存目录；界面拼 novelive://cache/<path>
  error: opt(CommandError),
});
export type ImageCapResult = Static<typeof ImageCapResult>;

export const ImageTestResult = obj({
  t2i: ImageCapResult,
  transparent: ImageCapResult,
  edit: ImageCapResult,
});
export type ImageTestResult = Static<typeof ImageTestResult>;

export const EventEnvelope = obj({
  seq: int({ minimum: 1 }),
  scope: oneOf(["app", "work"] as const),
  scopeId: str(),
  at: str(), // ISO 时间
  event: obj({ type: str() }, { open: true }),
});
export type EventEnvelope = Static<typeof EventEnvelope>;

export const EventsListResult = obj({
  events: arr(EventEnvelope),
  gap: opt(bool()),
  snapshot: opt(obj({}, { open: true })),
});
export type EventsListResult = Static<typeof EventsListResult>;

// ---------- 帧：命令 ----------
export const CommandFrame = obj({
  kind: lit("command"),
  generation: int({ minimum: 0 }),
  requestId: str(),
  command: CommandName,
  payload: obj({}, { open: true }),
});
export type CommandFrame = Static<typeof CommandFrame>;

export const CancelFrame = obj({
  kind: lit("cancel"),
  generation: int({ minimum: 0 }),
  requestId: str(),
});
export type CancelFrame = Static<typeof CancelFrame>;

export const ResponseFrame = obj({
  kind: lit("response"),
  generation: int({ minimum: 0 }),
  requestId: str(),
  ok: bool(),
  result: opt(obj({}, { open: true })),
  error: opt(CommandError),
});
export type ResponseFrame = Static<typeof ResponseFrame>;

export const EventFrame = obj({
  kind: lit("event"),
  generation: int({ minimum: 0 }),
  envelope: EventEnvelope,
});
export type EventFrame = Static<typeof EventFrame>;

export const Frame = union([
  CommandFrame,
  CancelFrame,
  ResponseFrame,
  EventFrame,
]);
export type Frame = Static<typeof Frame>;

// ---------- 编译后的校验器（开发模式边界校验） ----------
export const validateFrame = compile(Frame);
export const validateCommandFrame = compile(CommandFrame);
export const validateResponseFrame = compile(ResponseFrame);
export const validateEventFrame = compile(EventFrame);
export const validateAppConfigOut = compile(AppConfigOut);
export const validateConfigUpdateReq = compile(ConfigUpdateReq);
export const validateEventsListReq = compile(EventsListReq);
export const validateModelTestTextReq = compile(ModelTestTextReq);

// ---------- 事件载荷 ----------
export const CreatorReadyEvent = obj({
  type: lit("creator.ready"),
  generation: int(),
});
export const CreatorDownEvent = obj({
  type: lit("creator.down"),
  generation: int(),
  reason: str(),
  willRestart: bool(),
  logDir: str(),
});
export type CreatorDownEvent = Static<typeof CreatorDownEvent>;
