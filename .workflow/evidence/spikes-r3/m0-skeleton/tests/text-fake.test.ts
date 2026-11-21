// W2 文本测试走 pi 对假服务的录制/回放验证。
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CreatorService } from "../packages/creator/src/service.js";
import { Cassette, cassetteKey } from "./cassette.mjs";

const FAKE = "http://127.0.0.1:8899/v1";

function svc() {
  const dir = mkdtempSync(join(tmpdir(), "nl-svc-"));
  const s = new CreatorService({ userDataDir: dir, cacheDir: join(dir, "cache"), generation: 1 });
  const frames: any[] = [];
  s.onFrame((f) => frames.push(f));
  return { s, frames };
}

async function call(s: CreatorService, command: string, payload: unknown) {
  const before = Date.now();
  const p = new Promise<any>((resolve) => {
    const off = s.onFrame((f: any) => {
      if (f.kind === "response" && f.requestId === "t1") {
        off();
        resolve(f);
      }
    });
  });
  void s.handle({ kind: "command", generation: 1, requestId: "t1", command, payload });
  const r = await p;
  r.latencyMs = Date.now() - before;
  return r;
}

describe("cassette text 通路", () => {
  it("record 模式：pi → 假服务 openai-completions，响应落 cassette", async () => {
    const { s } = svc();
    // 注入 cassette fetch：pi 的 streamFn 包装层在 creator 侧就是 fetch
    const cas = new Cassette("tests/fixtures/text-fake.jsonl", "record", { case: "text-completions" });
    const origFetch = globalThis.fetch;
    globalThis.fetch = cas.fetch() as typeof fetch;
    try {
      await call(s, "config.update", {
        models: { fast: { apiFormat: "openai-completions", baseUrl: FAKE, model: "fake-1", contextLength: 0, apiKey: "sk-fake", inheritFast: false } },
      });
      const r = await call(s, "model.testText", { slot: "fast" });
      expect(r.ok).toBe(true);
      expect((r.result as any).test.ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("replay 模式：同一 cassette 离线回放，未命中不联网", async () => {
    const { s } = svc();
    const cas = new Cassette("tests/fixtures/text-fake.jsonl", "strict");
    const origFetch = globalThis.fetch;
    // strict 下所有 fetch 都走 cassette；未命中会 throw（这里假服务其实在线，回放不碰）
    globalThis.fetch = cas.fetch() as typeof fetch;
    try {
      await call(s, "config.update", {
        models: { fast: { apiFormat: "openai-completions", baseUrl: FAKE, model: "fake-1", contextLength: 0, apiKey: "sk-fake", inheritFast: false } },
      });
      const r = await call(s, "model.testText", { slot: "fast" });
      expect(r.ok).toBe(true);
      expect((r.result as any).test.ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("key = sha256(method+path+canonicalBody) 前 16 hex", () => {
    const k1 = cassetteKey("POST", "/v1/chat/completions", '{"a":1,"b":2}');
    const k2 = cassetteKey("POST", "/v1/chat/completions", '{"b":2,"a":1}');
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
  });
});
