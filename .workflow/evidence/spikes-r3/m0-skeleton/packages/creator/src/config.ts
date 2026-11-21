// 配置读写：config.json 只由创作端读写。API Key AES-256-GCM 加密（密钥是源码常量，只防扫一眼）。
// config.get 返回 apiKeyMasked 哨兵；config.update 收到哨兵或空串时保留旧值。先写临时文件再改名。
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  API_KEY_MASK,
  type ApiFormat,
  type AppConfigOut,
  type ConfigUpdateReq,
  type ImageModelConfigIn,
  type TextModelSlot,
} from "./contract.js";

// 写在程序里的固定密钥（32 字节 hex）。只防扫一眼，不防逆向。
const CONFIG_KEY_HEX =
  "6e6f76656c6976652d636f6e6669672d6b65792d3030312d7370696b65212d6d30";
const KEY = Buffer.from(createHash("sha256").update(CONFIG_KEY_HEX).digest());

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(stored: string): string {
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !data) return stored; // 兼容未加密旧值
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    d.update(Buffer.from(data, "base64")),
    d.final(),
  ]).toString("utf8");
}

interface TextSlotStored {
  apiFormat: ApiFormat;
  baseUrl: string;
  model: string;
  contextLength: number;
  apiKeyEnc: string; // "" 表示未设置
  inheritFast: boolean;
}
interface StoredConfig {
  version: 1;
  models: Record<TextModelSlot, TextSlotStored>;
  image: {
    baseUrl: string;
    model: string;
    apiKeyEnc: string;
    concurrency: number;
    retries: number;
  };
  interface: { language: string; theme: "light" | "dark" | "system" };
  project: { defaultDir: string };
}

const defaultText = (): TextSlotStored => ({
  apiFormat: "openai-completions",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  contextLength: 0,
  apiKeyEnc: "",
  inheritFast: true,
});

const defaultConfig = (): StoredConfig => ({
  version: 1,
  models: {
    fast: defaultText(),
    main: defaultText(),
    writing: defaultText(),
    visual: defaultText(),
  },
  image: {
    baseUrl: "https://api.openai.com/v1",
    model: "",
    apiKeyEnc: "",
    concurrency: 8,
    retries: 3,
  },
  interface: { language: "zh-Hans", theme: "system" },
  project: { defaultDir: "" },
});

/** 目录命中上下文长度：pi 内置模型目录可查就自动覆盖手填值 */
export type ContextLookup = (
  provider: string,
  modelId: string,
) => number | undefined;

export class ConfigStore {
  readonly path: string;
  private cfg: StoredConfig;
  private loadError: string | null = null;
  private contextLookup: ContextLookup;

  constructor(dir: string, contextLookup: ContextLookup = () => undefined) {
    this.path = join(dir, "config.json");
    this.contextLookup = contextLookup;
    this.cfg = defaultConfig();
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as StoredConfig;
      this.cfg = { ...defaultConfig(), ...parsed };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        // 读不出来：报错不覆盖原文件（spec：界面显示文件位置和错误信息）
        this.loadError = `${(e as Error).message}`;
      }
    }
  }

  getLoadError() {
    return this.loadError;
  }

  private resolveContextLength(s: TextSlotStored): {
    value: number;
    source: "catalog" | "manual" | "none";
  } {
    const provider = apiFormatToProvider(s.apiFormat);
    const hit = this.contextLookup(provider, s.model);
    if (hit !== undefined) return { value: hit, source: "catalog" };
    if (s.contextLength > 0)
      return { value: s.contextLength, source: "manual" };
    return { value: 0, source: "none" };
  }

  private slotOut(s: TextSlotStored) {
    const ctx = this.resolveContextLength(s);
    const plain = s.apiKeyEnc ? decrypt(s.apiKeyEnc) : "";
    return {
      apiFormat: s.apiFormat,
      baseUrl: s.baseUrl,
      model: s.model,
      contextLength: ctx.value,
      contextSource: ctx.source,
      apiKeyMasked: plain ? API_KEY_MASK : "",
      apiKeySet: plain.length > 0,
      inheritFast: s.inheritFast,
    };
  }

  get(): AppConfigOut {
    return {
      version: 1,
      models: {
        fast: this.slotOut(this.cfg.models.fast),
        main: this.slotOut(this.cfg.models.main),
        writing: this.slotOut(this.cfg.models.writing),
        visual: this.slotOut(this.cfg.models.visual),
      },
      image: {
        baseUrl: this.cfg.image.baseUrl,
        model: this.cfg.image.model,
        apiKeyMasked: this.cfg.image.apiKeyEnc ? API_KEY_MASK : "",
        apiKeySet: this.cfg.image.apiKeyEnc.length > 0,
        concurrency: this.cfg.image.concurrency,
        retries: this.cfg.image.retries,
      },
      interface: this.cfg.interface,
      project: this.cfg.project,
    };
  }

  /** 测试用明文视图：只在创作端内部用，不出进程 */
  private textSlotPlain(slot: TextModelSlot): {
    apiFormat: ApiFormat;
    baseUrl: string;
    model: string;
    contextLength: number;
    apiKey: string;
  } {
    let s = this.cfg.models[slot];
    if (slot !== "fast" && s.inheritFast) {
      const f = this.cfg.models.fast;
      s = {
        ...s,
        apiFormat: f.apiFormat,
        baseUrl: f.baseUrl,
        apiKeyEnc: f.apiKeyEnc,
      };
    }
    const ctx = this.resolveContextLength(s);
    return {
      apiFormat: s.apiFormat,
      baseUrl: s.baseUrl,
      model: s.model,
      contextLength: ctx.value,
      apiKey: s.apiKeyEnc ? decrypt(s.apiKeyEnc) : "",
    };
  }

  textSlot(slot: TextModelSlot) {
    return this.textSlotPlain(slot);
  }

  imageSlot() {
    const i = this.cfg.image;
    return {
      baseUrl: i.baseUrl,
      model: i.model,
      apiKey: i.apiKeyEnc ? decrypt(i.apiKeyEnc) : "",
      concurrency: i.concurrency,
      retries: i.retries,
    };
  }

  /** 按字段合并；apiKey 收到哨兵或空串时保留旧值 */
  update(patch: ConfigUpdateReq): AppConfigOut {
    if (patch.models) {
      for (const k of ["fast", "main", "writing", "visual"] as const) {
        const p = patch.models[k];
        if (!p) continue;
        const cur = this.cfg.models[k];
        this.cfg.models[k] = {
          apiFormat: p.apiFormat,
          baseUrl: p.baseUrl,
          model: p.model,
          contextLength: p.contextLength,
          inheritFast: p.inheritFast,
          apiKeyEnc:
            p.apiKey === API_KEY_MASK || p.apiKey === ""
              ? cur.apiKeyEnc
              : encrypt(p.apiKey),
        };
      }
    }
    if (patch.image) {
      const p: ImageModelConfigIn = patch.image;
      const cur = this.cfg.image;
      this.cfg.image = {
        baseUrl: p.baseUrl,
        model: p.model,
        concurrency: p.concurrency,
        retries: p.retries,
        apiKeyEnc:
          p.apiKey === API_KEY_MASK || p.apiKey === ""
            ? cur.apiKeyEnc
            : encrypt(p.apiKey),
      };
    }
    if (patch.interface) this.cfg.interface = patch.interface;
    if (patch.project) this.cfg.project = patch.project;
    this.save();
    return this.get();
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(this.cfg, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
}

export function apiFormatToProvider(f: ApiFormat): string {
  // pi 目录按 provider 组织；接口格式粗映射到目录 provider，命中与否都不致命
  switch (f) {
    case "openai-completions":
    case "openai-responses":
      return "openai";
    case "anthropic-messages":
      return "anthropic";
  }
}
