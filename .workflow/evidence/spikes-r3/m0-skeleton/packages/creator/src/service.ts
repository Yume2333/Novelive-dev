// 创作端核心：与传输无关的命令分发 + 事件 ring buffer。
// Electron 走 MessagePort（entry.ts），dev-bridge 走 WebSocket，两者共用这里。

import { ConfigStore } from "./config.js";
import {
  type CommandError,
  type CommandFrame,
  type EventEnvelope,
  type Frame,
  type ResponseFrame,
  validateCommandFrame,
  validateConfigUpdateReq,
  validateEventsListReq,
  validateModelTestTextReq,
} from "./contract.js";
import { log } from "./log.js";
import {
  catalogContextLength,
  testImageModel,
  testTextModel,
} from "./models.js";
import { sharpSmoke } from "./sharp-smoke.js";
import { sqliteSmoke } from "./sqlite-smoke.js";

const RING_SIZE = 500;

export interface CreatorServiceOptions {
  userDataDir: string;
  cacheDir: string;
  generation: number;
}

interface Scope {
  seq: number;
  ring: EventEnvelope[];
}

export class CreatorService {
  private cfg: ConfigStore;
  private scopes = new Map<string, Scope>();
  private inflight = new Map<string, AbortController>();
  private listeners = new Set<(f: Frame) => void>();
  readonly generation: number;
  private cacheDir: string;

  constructor(opts: CreatorServiceOptions) {
    this.generation = opts.generation;
    this.cacheDir = opts.cacheDir;
    this.cfg = new ConfigStore(opts.userDataDir, catalogContextLength);
    // app scope 事件序列从 1 开始
    this.scopes.set("app:", { seq: 0, ring: [] });
  }

  get configStore() {
    return this.cfg;
  }

  onFrame(cb: (f: Frame) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(scope: "app" | "work", scopeId: string, event: Record<string, unknown>) {
    const key = `${scope}:${scopeId}`;
    let s = this.scopes.get(key);
    if (!s) {
      s = { seq: 0, ring: [] };
      this.scopes.set(key, s);
    }
    const envelope: EventEnvelope = {
      seq: ++s.seq,
      scope,
      scopeId,
      at: new Date().toISOString(),
      event: event as EventEnvelope["event"],
    };
    s.ring.push(envelope);
    if (s.ring.length > RING_SIZE) s.ring.shift();
    const frame: Frame = {
      kind: "event",
      generation: this.generation,
      envelope,
    };
    for (const cb of this.listeners) cb(frame);
  }

  /** port/窗口销毁：中止该端口在途请求（M0 只有一个 port 概念，统一中止） */
  abortAll() {
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
  }

  private ok(
    requestId: string,
    result: Record<string, unknown>,
  ): ResponseFrame {
    return {
      kind: "response",
      generation: this.generation,
      requestId,
      ok: true,
      result,
    };
  }

  private fail(requestId: string, error: CommandError): ResponseFrame {
    return {
      kind: "response",
      generation: this.generation,
      requestId,
      ok: false,
      error,
    };
  }

  async handle(raw: unknown): Promise<void> {
    // cancel 帧单独通道：不进 CommandFrame 校验（词表不含它）
    const kind = (raw as { kind?: string })?.kind;
    if (kind === "cancel") {
      const rid = (raw as { requestId?: string })?.requestId;
      if (rid) this.inflight.get(rid)?.abort();
      return;
    }
    const v = validateCommandFrame.errors(raw);
    if (v.length > 0) {
      // 开发模式边界校验：不合法的消息记日志
      log("frame.invalid", { errors: v.slice(0, 3) });
      return;
    }
    const frame = raw as CommandFrame;
    log("command.recv", {
      requestId: frame.requestId,
      command: frame.command,
      generation: frame.generation,
    });
    let resp: ResponseFrame;
    const ac = new AbortController();
    this.inflight.set(frame.requestId, ac);
    try {
      resp = await this.dispatch(frame, ac.signal);
    } catch (e) {
      resp = this.fail(frame.requestId, {
        code: "internal",
        message: String(e).slice(0, 300),
      });
    } finally {
      this.inflight.delete(frame.requestId);
    }
    for (const cb of this.listeners) cb(resp);
    log("command.done", { requestId: frame.requestId, ok: resp.ok });
  }

  private async dispatch(
    frame: CommandFrame,
    signal: AbortSignal,
  ): Promise<ResponseFrame> {
    const { requestId, command, payload } = frame;
    switch (command) {
      case "config.get": {
        const out = this.cfg.get();
        const loadError = this.cfg.getLoadError();
        return this.ok(requestId, {
          config: out,
          configPath: this.cfg.path,
          ...(loadError ? { loadError } : {}),
        });
      }
      case "config.update": {
        const errs = validateConfigUpdateReq.errors(payload);
        if (errs.length)
          return this.fail(requestId, {
            code: "invalid_config",
            message: errs.map((e) => `${e.path} ${e.message}`).join("; "),
          });
        const out = this.cfg.update(payload);
        return this.ok(requestId, { config: out });
      }
      case "model.testText": {
        const errs = validateModelTestTextReq.errors(payload);
        if (errs.length)
          return this.fail(requestId, {
            code: "invalid_config",
            message: "slot 必填",
          });
        const slot = (
          payload as { slot: "fast" | "main" | "writing" | "visual" }
        ).slot;
        const conf = this.cfg.textSlot(slot);
        const result = await testTextModel(conf, {
          signal,
          withImage: slot === "visual",
        });
        return result.ok
          ? this.ok(requestId, { test: result })
          : this.fail(
              requestId,
              result.error ?? { code: "internal", message: "失败" },
            );
      }
      case "model.testImage": {
        const conf = this.cfg.imageSlot();
        const result = await testImageModel(conf, this.cacheDir, { signal });
        const allFail =
          result.t2i.state !== "ok" &&
          result.transparent.state !== "ok" &&
          result.edit.state !== "ok";
        return this.ok(requestId, { test: result, overallOk: !allFail });
      }
      case "events.list": {
        const errs = validateEventsListReq.errors(payload);
        if (errs.length)
          return this.fail(requestId, {
            code: "invalid_config",
            message: errs.map((e) => `${e.path} ${e.message}`).join("; "),
          });
        const p = payload as {
          scope: "app" | "work";
          scopeId: string;
          afterSeq: number;
        };
        const s = this.scopes.get(`${p.scope}:${p.scopeId}`);
        const ring = s?.ring ?? [];
        const oldest = ring.length ? (ring[0]?.seq ?? 0) : 0;
        const events = ring.filter((e) => e.seq > p.afterSeq);
        if (oldest > p.afterSeq + 1) {
          // ring 溢出：gap:true + 该 scope 最新快照（app scope 快照=创作端当前状态）
          return this.ok(requestId, {
            events,
            gap: true,
            snapshot: { ready: true, generation: this.generation },
          });
        }
        return this.ok(requestId, { events });
      }
      case "debug.sqliteSmoke": {
        return this.ok(requestId, { smoke: sqliteSmoke(this.cacheDir) });
      }
      case "debug.sharpSmoke": {
        return this.ok(requestId, { smoke: await sharpSmoke(this.cacheDir) });
      }
      default:
        return this.fail(requestId, {
          code: "invalid_config",
          message: `未知命令 ${command}`,
        });
    }
  }
}
