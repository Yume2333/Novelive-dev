// 单测：config.get 掩码、config.update 掩码回写不丢旧值、events.list 补漏、契约校验。

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigStore } from "../packages/creator/src/config.js";
import {
  API_KEY_MASK,
  validateCommandFrame,
} from "../packages/creator/src/contract.js";
import { CreatorService } from "../packages/creator/src/service.js";

const dir = () => mkdtempSync(join(tmpdir(), "nl-cfg-"));

describe("config", () => {
  it("config.get 返回掩码哨兵，不泄露明文", () => {
    const s = new ConfigStore(dir());
    s.update({
      models: {
        fast: {
          apiFormat: "openai-completions",
          baseUrl: "https://x/v1",
          model: "m1",
          contextLength: 0,
          apiKey: "sk-secret-123",
          inheritFast: false,
        },
      },
    });
    const out = s.get();
    expect(out.models.fast.apiKeyMasked).toBe(API_KEY_MASK);
    expect(out.models.fast.apiKeySet).toBe(true);
    // 内部视图能取回明文
    expect(s.textSlot("fast").apiKey).toBe("sk-secret-123");
  });

  it("config.update 收到掩码或空串保留旧值", () => {
    const s = new ConfigStore(dir());
    s.update({
      models: {
        fast: {
          apiFormat: "openai-completions",
          baseUrl: "b",
          model: "m",
          contextLength: 0,
          apiKey: "sk-A",
          inheritFast: false,
        },
      },
    });
    s.update({
      models: {
        fast: {
          apiFormat: "openai-completions",
          baseUrl: "b2",
          model: "m2",
          contextLength: 0,
          apiKey: API_KEY_MASK,
          inheritFast: false,
        },
      },
    });
    expect(s.textSlot("fast").apiKey).toBe("sk-A");
    expect(s.textSlot("fast").model).toBe("m2");
    s.update({
      models: {
        fast: {
          apiFormat: "openai-completions",
          baseUrl: "b",
          model: "m",
          contextLength: 0,
          apiKey: "",
          inheritFast: false,
        },
      },
    });
    expect(s.textSlot("fast").apiKey).toBe("sk-A");
  });

  it("重启后配置还在（写临时文件再改名）", () => {
    const d = dir();
    const s1 = new ConfigStore(d);
    s1.update({
      image: {
        baseUrl: "https://img/v1",
        model: "gpt-img",
        apiKey: "k",
        concurrency: 4,
        retries: 2,
      },
      project: { defaultDir: "/data/x" },
    });
    const s2 = new ConfigStore(d);
    expect(s2.get().image.model).toBe("gpt-img");
    expect(s2.get().image.concurrency).toBe(4);
    expect(s2.get().project.defaultDir).toBe("/data/x");
  });
});

describe("events.list", () => {
  it("afterSeq 之后能补回遗漏事件", async () => {
    const svc = new CreatorService({
      userDataDir: dir(),
      cacheDir: dir(),
      generation: 7,
    });
    const frames: unknown[] = [];
    svc.onFrame((f) => frames.push(f));
    svc.emit("app", "", { type: "creator.ready", generation: 7 });
    svc.emit("app", "", { type: "x", n: 2 });
    const res = await new Promise<unknown>((resolve) => {
      svc.onFrame(function h(f) {
        const fr = f as { kind?: string; result?: unknown };
        if (fr.kind === "response") resolve(fr.result);
      });
      void svc.handle({
        kind: "command",
        generation: 7,
        requestId: "q1",
        command: "events.list",
        payload: { scope: "app", scopeId: "", afterSeq: 1 },
      });
    });
    const list = (res as { events: { seq: number }[] }).events;
    expect(list.length).toBe(1);
    expect(list[0]?.seq).toBe(2);
  });
});

describe("contract", () => {
  it("不合法的命令帧被拒", () => {
    const errs = validateCommandFrame.errors({
      kind: "command",
      generation: 0,
      requestId: "x",
      command: "nope",
      payload: {},
    });
    expect(errs.length).toBeGreaterThan(0);
    expect(
      validateCommandFrame.errors({
        kind: "command",
        generation: 1,
        requestId: "x",
        command: "config.get",
        payload: {},
      }),
    ).toHaveLength(0);
  });
});
