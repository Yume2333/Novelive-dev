import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import {
  getBuiltinModels,
  getBuiltinProviders,
} from "@earendil-works/pi-ai/providers/all";
import OpenAI, { toFile } from "openai";
import type {
  ApiFormat,
  CommandError,
  ErrorCode,
  ImageTestResult,
  TextTestResult,
} from "./contract.js";

// ---------- pi 内置模型目录：按模型 id 查上下文长度 ----------
// 目录按 provider 组织；跨 provider 查同一 model id，目录命中优先于手填（spec）。
let catalogIndex: Map<
  string,
  { contextWindow: number; provider: string }
> | null = null;

function buildIndex() {
  catalogIndex = new Map();
  for (const p of getBuiltinProviders()) {
    for (const m of getBuiltinModels(p)) {
      const cur = catalogIndex?.get(m.id);
      // 先到的 provider 优先（openai/anthropic 等一手的在前面）
      if (!cur || cur.contextWindow === 0) {
        catalogIndex?.set(m.id, {
          contextWindow: m.contextWindow ?? 0,
          provider: p,
        });
      }
    }
  }
}

export function catalogContextLength(
  _provider: string,
  modelId: string,
): number | undefined {
  if (!catalogIndex) {
    try {
      buildIndex();
    } catch {
      catalogIndex = new Map();
    }
  }
  const hit = catalogIndex?.get(modelId);
  return hit && hit.contextWindow > 0 ? hit.contextWindow : undefined;
}

// ---------- 错误分类 ----------
export function classifyError(e: unknown): CommandError {
  const err = e as {
    status?: number;
    code?: string;
    message?: string;
    name?: string;
  };
  const status =
    err?.status ??
    (err as { response?: { status?: number } })?.response?.status;
  const msg = String(err?.message ?? e ?? "unknown error").slice(0, 500);
  if (
    err?.name === "AbortError" ||
    err?.code === "ABORT_ERR" ||
    /abort/i.test(msg)
  ) {
    return { code: "cancelled", message: "已取消" };
  }
  if (
    status === 401 ||
    status === 403 ||
    /invalid[_ ]api[_ ]?key|unauthorized|authentication/i.test(msg)
  ) {
    return {
      code: "auth",
      message: `认证失败（${status ?? "?"}）：检查 API Key`,
    };
  }
  if (
    status === 404 ||
    /model.*not.*found|does not exist|NotFound/i.test(msg)
  ) {
    return {
      code: "not_found",
      message: `找不到模型（${status ?? "?"}）：检查模型名`,
    };
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|timeout/i.test(
      msg,
    )
  ) {
    return { code: "network", message: `网络错误：检查接口地址 — ${msg}` };
  }
  if (status === 400 || /invalid|bad request/i.test(msg)) {
    return {
      code: "invalid_config",
      message: `请求被拒（${status ?? "?"}）：${msg}`,
    };
  }
  return { code: "internal", message: msg };
}

function buildModel(slot: {
  apiFormat: ApiFormat;
  baseUrl: string;
  model: string;
  contextLength: number;
}): Model<ApiFormat> {
  return {
    id: slot.model,
    name: slot.model,
    api: slot.apiFormat,
    provider: "custom" as Model<ApiFormat>["provider"],
    baseUrl: slot.baseUrl,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: slot.contextLength > 0 ? slot.contextLength : 128000,
    maxTokens: 4096,
  };
}

/** 文本模型测试：经 pi 发一次最短请求，收到回复算成功。可取消。 */
export async function testTextModel(
  slot: {
    apiFormat: ApiFormat;
    baseUrl: string;
    model: string;
    contextLength: number;
    apiKey: string;
  },
  opts: { signal?: AbortSignal; withImage?: boolean } = {},
): Promise<TextTestResult> {
  const started = Date.now();
  try {
    if (!slot.baseUrl || !slot.model || !slot.apiKey) {
      return {
        ok: false,
        error: {
          code: "invalid_config",
          message: "接口地址、模型名、API Key 未填全",
        },
      };
    }
    const model = buildModel(slot);
    const content: unknown[] | string = opts.withImage
      ? [
          { type: "text", text: "用一句话描述这张图的内容。" },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${TEST_PNG_B64}` },
          },
        ]
      : "回复「ok」即可。";
    const res = await complete(
      model,
      { messages: [{ role: "user", content } as never] },
      {
        apiKey: slot.apiKey,
        signal: opts.signal,
        maxTokens: 32,
        maxRetries: 0,
        timeoutMs: 60_000,
      },
    );
    const text = extractText(res);
    if (!text.trim()) {
      return {
        ok: false,
        error: { code: "internal", message: "模型返回了空回复" },
      };
    }
    return {
      ok: true,
      reply: text.slice(0, 200),
      model: res.model ?? slot.model,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return {
      ok: false,
      error: classifyError(e),
      latencyMs: Date.now() - started,
    };
  }
}

function extractText(res: unknown): string {
  const msg = res as {
    content?: unknown;
    stopReason?: string;
    errorMessage?: string;
  };
  if (msg?.errorMessage) throw new Error(msg.errorMessage);
  const c = msg?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: string }).text)
          : "",
      )
      .join("");
  }
  return "";
}

// ---------- 内置小测试图（1×1 红 PNG，给编辑测试当输入；也给视觉测试） ----------
export const TEST_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAATSURBVBhXY/iPA4YMmGHMgCEHRmRkAABbDANNlC9h7wAAAABJRU5ErkJggg==";

// 生成一张内置 512×512 测试 PNG（不依赖 sharp：手写最小 PNG 编码）。
// 红绿渐变 + 蓝方块，视觉上可辨认。
export function makeTestPngBase64(size = 512): string {
  const rows = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 3 + 1);
    rows[off] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      rows[p] = Math.floor((x / size) * 255);
      rows[p + 1] = Math.floor((y / size) * 255);
      rows[p + 2] =
        x > size / 3 && x < (size * 2) / 3 && y > size / 3 && y < (size * 2) / 3
          ? 230
          : 40;
    }
  }
  const raw = rows;
  const idat = deflatePng(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

import { deflateSync } from "node:zlib";

function deflatePng(d: Buffer) {
  return deflateSync(d, { level: 6 });
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crcValue = crc(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcValue, 0);
  return Buffer.concat([len, body, crcBuf]);
}
let table: Uint32Array | null = null;
function crc(buf: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 判断返回的图是否有 alpha（读 PNG 头 color type 6/4 或检查 tRNS；粗判） */
function pngHasAlpha(png: Buffer): boolean {
  if (png.length < 26 || png[0] !== 137) return false;
  const colorType = png[25];
  return colorType === 4 || colorType === 6;
}

/** 图片模型测试：文生图、透明底、图片编辑三项各自出结果。文生图失败不阻塞编辑项。 */
export async function testImageModel(
  slot: { baseUrl: string; model: string; apiKey: string },
  cacheDir: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ImageTestResult> {
  const out: ImageTestResult = {
    t2i: { state: "skipped" },
    transparent: { state: "skipped" },
    edit: { state: "skipped" },
  };
  if (!slot.baseUrl || !slot.model || !slot.apiKey) {
    const err = {
      code: "invalid_config" as ErrorCode,
      message: "接口地址、模型名、API Key 未填全",
    };
    return {
      t2i: { state: "fail", error: err },
      transparent: { state: "fail", error: err },
      edit: { state: "fail", error: err },
    };
  }
  const client = new OpenAI({
    apiKey: slot.apiKey,
    baseURL: slot.baseUrl,
    maxRetries: 0,
    timeout: 120_000,
  });
  mkdirSync(cacheDir, { recursive: true });
  const save = async (b64: string, name: string) => {
    const buf = Buffer.from(b64, "base64");
    const rel = `model-test/${name}.png`;
    mkdirSync(join(cacheDir, "model-test"), { recursive: true });
    writeFileSync(join(cacheDir, rel), buf);
    return { rel, buf };
  };
  const pick = (r: {
    data?: { b64_json?: string | null; url?: string | null }[];
  }) => r.data?.[0]?.b64_json ?? null;

  // 1) 文生图
  try {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const r = await client.images.generate(
      {
        model: slot.model,
        prompt: "A small red cube on a white background, product photo",
        size: "1024x1024",
        n: 1,
      },
      { signal: opts.signal },
    );
    const b64 = pick(r);
    if (!b64) throw new Error("响应里没有 b64_json 图片");
    const { rel } = await save(b64, "t2i");
    out.t2i = { state: "ok", thumbnailPath: rel };
  } catch (e) {
    out.t2i = { state: "fail", error: classifyError(e) };
    if (out.t2i.error?.code === "cancelled") {
      out.transparent = { state: "skipped", error: out.t2i.error };
      out.edit = { state: "skipped", error: out.t2i.error };
      return out;
    }
  }

  // 2) 透明底（要求输出带 alpha）
  try {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const r = await client.images.generate(
      {
        model: slot.model,
        prompt: "A single green leaf, isolated object",
        size: "1024x1024",
        n: 1,
        background: "transparent",
      } as never,
      { signal: opts.signal },
    );
    const b64 = pick(r);
    if (!b64) throw new Error("响应里没有 b64_json 图片");
    const buf = Buffer.from(b64, "base64");
    if (!pngHasAlpha(buf)) {
      out.transparent = {
        state: "unsupported",
        error: {
          code: "internal",
          message: "返回图无 alpha 通道：模型不支持透明底",
        },
      };
    } else {
      writeFileSync(join(cacheDir, "model-test", "transparent.png"), buf);
      out.transparent = {
        state: "ok",
        thumbnailPath: "model-test/transparent.png",
      };
    }
  } catch (e) {
    const err = classifyError(e);
    if (err.code === "cancelled") {
      out.transparent = { state: "skipped", error: err };
      out.edit = { state: "skipped", error: err };
      return out;
    }
    out.transparent = { state: "fail", error: err };
  }

  // 3) 图片编辑（内置小测试图；文生图失败不阻塞）
  try {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const input = Buffer.from(makeTestPngBase64(512), "base64");
    const file = await toFile(input, "input.png", { type: "image/png" });
    const r = await client.images.edit(
      {
        model: slot.model,
        image: file,
        prompt:
          "Turn the blue square into a yellow circle, keep the gradient background",
        size: "1024x1024",
        n: 1,
      } as never,
      { signal: opts.signal },
    );
    const b64 = pick(r);
    if (!b64) throw new Error("响应里没有 b64_json 图片");
    const { rel } = await save(b64, "edit");
    out.edit = { state: "ok", thumbnailPath: rel };
  } catch (e) {
    out.edit = { state: "fail", error: classifyError(e) };
  }

  return out;
}
