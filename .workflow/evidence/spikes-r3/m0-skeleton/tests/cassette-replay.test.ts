// W2 回放验证：strict 离线回放 image cassette + cancel 故障 + e2e 断连恢复
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Cassette } from "./cassette.mjs";
import { CreatorService } from "../packages/creator/src/service.js";

function svc() {
  const dir = mkdtempSync(join(tmpdir(), "nl-svc-"));
  const s = new CreatorService({ userDataDir: dir, cacheDir: join(dir, "cache"), generation: 1 });
  return s;
}
async function call(s: CreatorService, command: string, payload: unknown, rid = "t1") {
  const p = new Promise<any>((resolve) => {
    const off = s.onFrame((f: any) => {
      if (f.kind === "response" && f.requestId === rid) { off(); resolve(f); }
    });
  });
  void s.handle({ kind: "command", generation: 1, requestId: rid, command, payload });
  return p;
}

describe("cassette 回放/故障", () => {
  it("strict 模式命中即回放，不触网（代理环境全无也能过）", async () => {
    const cas = new Cassette("tests/fixtures/image-real.jsonl", "strict");
    const f = cas.fetch();
    // 用与录制时同样的请求体无法构造（FormData/hash 依赖），直接以 cassette 内 key 反查验证：
    // strict 下未命中 = 抛错而不是联网
    await expect(f("https://example.invalid/never", { method: "GET" })).rejects.toThrow(/strict 回放未命中/);
    // 命中：重放 bodyFile 的大体数据（>256KB 外置）
    const rec = (cas as any).byKey.get("9e81ccdaeed2a1ff");
    expect(rec.status).toBe(200);
    const body = (cas as any)._bodyOf(rec);
    expect(body.length).toBeGreaterThan(1_000_000);
    const parsed = JSON.parse(body.toString("utf8"));
    expect(parsed.data[0].b64_json.length).toBeGreaterThan(1_000_000);
  });

  it("cancel 帧中断进行中的 model.testText（fake-llm 慢 SSE）", async () => {
    const s = svc();
    await call(s, "config.update", {
      models: { fast: { apiFormat: "openai-completions", baseUrl: "http://127.0.0.1:8899/slow/v1", model: "fake-1", contextLength: 0, apiKey: "sk-fake", inheritFast: false } },
    });
    const t0 = Date.now();
    const p = call(s, "model.testText", { slot: "fast" }, "c1");
    await new Promise((r) => setTimeout(r, 300));
    await s.handle({ kind: "cancel", generation: 1, requestId: "c1" });
    const r = await Promise.race([p, new Promise((res) => setTimeout(() => res("timeout"), 8000))]);
    const ms = Date.now() - t0;
    console.log("cancel result:", r === "timeout" ? "TIMEOUT" : { ok: r.ok, err: r.error, ms });
    expect(r).not.toBe("timeout");
    expect(r.ok).toBe(false);
    expect((r.error as any).code).toBe("cancelled");
    expect(ms).toBeLessThan(5000);
  });

  it("http500 故障注入返回 500 而非连接错误", async () => {
    const cas = new Cassette("/tmp/nonexistent.jsonl", "record");
    cas.injectFault({ match: "POST /x", type: "http500" });
    const f = cas.fetch();
    const r = await f("http://h/x", { method: "POST", body: "{}" });
    expect(r.status).toBe(500);
  });

  it("disconnect 故障抛 fetch failed", async () => {
    const cas = new Cassette("/tmp/nonexistent2.jsonl", "record");
    cas.injectFault({ match: "POST /y", type: "disconnect" });
    const f = cas.fetch();
    await expect(f("http://h/y", { method: "POST", body: "" })).rejects.toThrow(/fetch failed/);
  });
});
