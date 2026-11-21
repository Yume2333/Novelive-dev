// 界面侧类型：对齐 @novelive/creator/contract 的输出形状（界面只依赖 window.novelive，不 import creator 包实现）。
export type ApiFormat =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages";
export type TextSlot = "fast" | "main" | "writing" | "visual";
export type ThemeMode = "light" | "dark" | "system";

export interface TextModelConfigOut {
  apiFormat: ApiFormat;
  baseUrl: string;
  model: string;
  contextLength: number;
  contextSource: "catalog" | "manual" | "none";
  apiKeyMasked: string;
  apiKeySet: boolean;
  inheritFast: boolean;
}

export interface ImageModelConfigOut {
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  apiKeySet: boolean;
  concurrency: number;
  retries: number;
}

export interface AppConfigOut {
  version: 1;
  models: Record<TextSlot, TextModelConfigOut>;
  image: ImageModelConfigOut;
  interface: { language: string; theme: ThemeMode };
  project: { defaultDir: string };
}

export interface ConfigGetResult {
  config: AppConfigOut;
  configPath: string;
  loadError?: string;
}

export interface TextTestResult {
  ok: boolean;
  reply?: string;
  model?: string;
  latencyMs?: number;
  error?: { code: string; message: string };
}

export interface ImageCapResult {
  state: "ok" | "unsupported" | "fail" | "skipped";
  thumbnailPath?: string;
  error?: { code: string; message: string };
}

export interface ImageTestResult {
  t2i: ImageCapResult;
  transparent: ImageCapResult;
  edit: ImageCapResult;
}

export const API_KEY_MASK = "••••";

export const apiFormats: {
  value: ApiFormat;
  label: string;
  defaultBase: string;
}[] = [
  {
    value: "openai-completions",
    label: "OpenAI Chat Completions",
    defaultBase: "https://api.openai.com/v1",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    defaultBase: "https://api.openai.com/v1",
  },
  {
    value: "anthropic-messages",
    label: "Anthropic Messages",
    defaultBase: "https://api.anthropic.com",
  },
];

export const modelSlots: {
  id: TextSlot | "image";
  label: string;
  icon: string;
}[] = [
  { id: "fast", label: "快速模型", icon: "bolt" },
  { id: "main", label: "主模型", icon: "psychology" },
  { id: "writing", label: "写作模型", icon: "edit_note" },
  { id: "visual", label: "视觉模型", icon: "visibility" },
  { id: "image", label: "图片模型", icon: "image" },
];
