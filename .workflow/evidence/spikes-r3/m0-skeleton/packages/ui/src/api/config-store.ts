// 配置在界面的读写通道：config.get 拉取，config.update 回写（Key 用掩码哨兵语义）。
import { bridge } from "./bridge";
import type {
  AppConfigOut,
  ConfigGetResult,
  ImageModelConfigOut,
  TextModelConfigOut,
  TextSlot,
} from "./types";

export async function fetchConfig(): Promise<ConfigGetResult> {
  return (await bridge().call("config.get", {}).promise) as ConfigGetResult;
}

export async function updateConfig(patch: {
  models?: Partial<Record<TextSlot, TextModelConfigIn>>;
  image?: ImageModelConfigIn;
  interface?: AppConfigOut["interface"];
  project?: AppConfigOut["project"];
}): Promise<AppConfigOut> {
  const res = (await bridge().call("config.update", patch).promise) as {
    config: AppConfigOut;
  };
  return res.config;
}

/** 界面 → 创作的文本槽：掩码哨兵直接回传（服务端保留旧值） */
export interface TextModelConfigIn {
  apiFormat: TextModelConfigOut["apiFormat"];
  baseUrl: string;
  model: string;
  contextLength: number;
  apiKey: string; // 明文或 API_KEY_MASK
  inheritFast: boolean;
}

export interface ImageModelConfigIn {
  baseUrl: string;
  model: string;
  apiKey: string;
  concurrency: number;
  retries: number;
}

export function toTextIn(
  c: TextModelConfigOut,
  keyOverride?: string,
): TextModelConfigIn {
  return {
    apiFormat: c.apiFormat,
    baseUrl: c.baseUrl,
    model: c.model,
    contextLength: c.contextLength,
    apiKey: keyOverride ?? c.apiKeyMasked,
    inheritFast: c.inheritFast,
  };
}

export function toImageIn(
  c: ImageModelConfigOut,
  keyOverride?: string,
): ImageModelConfigIn {
  return {
    baseUrl: c.baseUrl,
    model: c.model,
    apiKey: keyOverride ?? c.apiKeyMasked,
    concurrency: c.concurrency,
    retries: c.retries,
  };
}
