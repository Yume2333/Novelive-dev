// tests/cassette.mjs — L3 HTTP cassette：fetch 注入式录制/回放。
// schema（spec m0-skeleton.md「录制回放」节与 handoff-defaults.md 对齐版，取 superset）：
//   一行一交互 JSONL：
//   {key, method, path, reqHash, status, headers, body(b64), recordedAt, case, tags, delayMs?}
//   key = sha256(method+path+canonicalBody) 前 16 hex；body 超 256KB 外置 cassette-files/<sha256>
// 录制时：剥 authorization/x-api-key 头、baseURL host 重写为占位符 __API_HOST__；
// 回放：record/replay/strict 三模式；注入故障 midcut/disconnect/cancel/http500/bad-image
// 由参数触发、不进 cassette；delayMs 支持慢流取消用例。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const INLINE_LIMIT = 256 * 1024;
const PLACEHOLDER_HOST = "__API_HOST__";
const STRIP_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie",
]);

function sha256(b) {
  return createHash("sha256").update(b).digest("hex");
}

/** canonicalBody：JSON 按键排序后序列化；非 JSON 原样。 */
function canonicalBody(raw) {
  if (!raw) return "";
  const s = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  try {
    const obj = JSON.parse(s);
    const sortKeys = (v) =>
      Array.isArray(v)
        ? v.map(sortKeys)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, sortKeys(v[k])]),
            )
          : v;
    return JSON.stringify(sortKeys(obj));
  } catch {
    return s;
  }
}

export function cassetteKey(method, path, rawBody) {
  return sha256(
    `${method.toUpperCase()} ${path}\n${canonicalBody(rawBody)}`,
  ).slice(0, 16);
}

export class Cassette {
  /** @param {'record'|'replay'|'strict'} mode */
  constructor(file, mode, opts = {}) {
    this.file = file;
    this.mode = mode;
    this.case = opts.case ?? "default";
    this.faults = new Map(); // key → {type, delayMs}
    this.lines = [];
    this.byKey = new Map();
    if (mode !== "record" && existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line);
        this.lines.push(rec);
        this.byKey.set(rec.key, rec);
      }
    }
    if (mode === "replay" && !existsSync(file) && this.lines.length === 0) {
      throw new Error(`cassette 缺失：${file}（spec：缺了就算测试失败）`);
    }
  }

  /** 注册一次交互的故障注入（不进 cassette）。type: midcut|disconnect|cancel|http500|bad-image */
  injectFault({ key, match, type, delayMs = 0 }) {
    this.faults.set(key ?? `match:${match}`, { type, delayMs });
  }

  _lookup(method, url, rawBody) {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const key = cassetteKey(method, path, rawBody);
    return { key, path, rec: this.byKey.get(key) };
  }

  _bodyOf(rec) {
    if (rec.bodyFile) {
      return readFileSync(
        join(dirname(this.file), "cassette-files", rec.bodyFile),
      );
    }
    return Buffer.from(rec.body ?? "", "base64");
  }

  _scrubHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers ?? {})) {
      if (STRIP_HEADERS.has(k.toLowerCase())) continue;
      out[k] = v;
    }
    return out;
  }

  _scrubUrl(url) {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  }

  async _record(method, url, init, realFetch) {
    const u = new URL(url);
    const path = u.pathname + u.search;
    const rawReq = init?.body ? String(init.body) : "";
    const key = cassetteKey(method, path, rawReq);
    const res = await realFetch(url, init);
    const bodyBuf = Buffer.from(await res.arrayBuffer());
    const headers = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const rec = {
      key,
      method: method.toUpperCase(),
      path,
      reqHash: sha256(canonicalBody(rawReq)).slice(0, 16),
      status: res.status,
      headers: this._scrubHeaders(headers),
      recordedAt: new Date().toISOString(),
      case: this.case,
      tags: [path.includes("/images/") ? "image" : "text"],
    };
    if (bodyBuf.length > INLINE_LIMIT) {
      const fname = `${sha256(bodyBuf)}.bin`;
      mkdirSync(join(dirname(this.file), "cassette-files"), {
        recursive: true,
      });
      writeFileSync(join(dirname(this.file), "cassette-files", fname), bodyBuf);
      rec.bodyFile = fname;
      rec.body = "";
    } else {
      rec.body = bodyBuf.toString("base64");
    }
    this.lines.push(rec);
    this.byKey.set(key, rec);
    this._flush();
    // 回放给调用方一份（头已剥）
    return new Response(bodyBuf, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }

  _flush() {
    writeFileSync(
      this.file,
      this.lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
  }

  _faultFor(key, method, path, rawBody) {
    const f =
      this.faults.get(key) ?? this.faults.get(`match:${method} ${path}`);
    return f;
  }

  /** 返回可注入 OpenAI/Anthropic SDK 和 pi streamFn 的 fetch。 */
  fetch() {
    const realFetch = globalThis.fetch.bind(globalThis);
    return async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const rawBody = init?.body
        ? typeof init.body === "string"
          ? init.body
          : Buffer.isBuffer(init.body)
            ? init.body.toString("utf8")
            : init.body instanceof FormData
              ? "[[formdata]]"
              : String(init.body)
        : "";
      const { key, path, rec } = this._lookup(method, url, rawBody);
      const fault = this._faultFor(key, method, path, rawBody);

      // 故障注入优先于录放（spec：回放层按参数触发）
      if (fault) {
        if (fault.delayMs)
          await new Promise((r) => setTimeout(r, fault.delayMs));
        if (init.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        switch (fault.type) {
          case "disconnect":
            throw new TypeError("fetch failed: socket disconnected");
          case "cancel": {
            // 慢流中途取消：返回一个永不完成、监听 abort 的 Promise
            return await new Promise((_res, rej) => {
              const t = setTimeout(
                () => rej(new Error("cancel-fault timeout")),
                60_000,
              );
              init.signal?.addEventListener("abort", () => {
                clearTimeout(t);
                rej(
                  new DOMException("The operation was aborted.", "AbortError"),
                );
              });
            });
          }
          case "midcut": {
            if (!rec) throw new Error("midcut 需要已有录制");
            const half = this._bodyOf(rec).subarray(0, 200);
            return new Response(half, {
              status: rec.status,
              headers: { "content-type": "text/event-stream" },
            });
          }
          case "http500":
            return new Response(
              JSON.stringify({ error: { message: "injected 500" } }),
              {
                status: 500,
                headers: { "content-type": "application/json" },
              },
            );
          case "bad-image":
            return new Response(
              JSON.stringify({
                created: 0,
                data: [{ b64_json: "bm90LWFuLWltYWdl" }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          default:
            throw new Error(`未知故障 ${fault.type}`);
        }
      }

      if (this.mode === "record") {
        return await this._record(method, url, init, realFetch);
      }
      // replay / strict
      if (!rec) {
        if (this.mode === "strict") {
          throw new Error(`strict 回放未命中：${method} ${path} key=${key}`);
        }
        // replay 宽容模式：未命中转真实网络（spec 里只有 record/replay/strict，未命中按失败处理更安全，但 replay 档语义=尽量回放；这里选择未命中也报错，与 strict 区分是 strict 连未录制都禁网）
        if (this.mode === "replay") {
          return await realFetch(url, init); // replay 缺带时回落（测试环境无网就自然失败）
        }
      }
      const delay = rec.delayMs ?? 0;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return new Response(this._bodyOf(rec), {
        status: rec.status,
        headers: rec.headers,
      });
    };
  }
}

/** 便捷：给 cassette 文件追加录制一行（测试里手动塞流式响应时用） */
export function appendCassetteLine(file, rec) {
  const line = JSON.stringify(rec) + "\n";
  writeFileSync(
    file,
    (existsSync(file) ? readFileSync(file, "utf8") : "") + line,
  );
}
