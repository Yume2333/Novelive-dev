// Creator utility process entry: node:sqlite WAL + sharp resize/webp + Python stdin/stdout child.
// ESM; electron-vite bundles this into out/utility/index.mjs; workspace pkg @trial/creator is bundled in.
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sharpSmoke } from "@trial/creator";

declare const process: NodeJS.Process & {
  parentPort: {
    postMessage(msg: unknown, transfer?: unknown[]): void;
    once(event: "message", cb: (e: { data: unknown; ports?: unknown[] }) => void): void;
  };
};

const workDir = process.env.TRIAL_WORK_DIR ?? "/tmp/nl-r2-trial-work";
mkdirSync(workDir, { recursive: true });

// ---- node:sqlite WAL ----
const dbPath = join(workDir, "trial.db");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode=WAL;");
db.exec("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);");
db.exec("INSERT OR REPLACE INTO kv(k,v) VALUES('hello','world');");
const row = db.prepare("SELECT v FROM kv WHERE k='hello'").get() as { v: string };
const journalMode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
const sqliteResult = { ok: row.v === "world", journalMode, dbPath };

// ---- sharp (from workspace package) ----
const sharpResult = await sharpSmoke(join(workDir, "out.webp"));

// ---- python stdin/stdout child ----
function runPython(): Promise<{ ok: boolean; reply: string; bin: string }> {
  return new Promise((resolve, reject) => {
    const script = process.env.TRIAL_PY_SCRIPT ?? "trial_sidecar.py";
    const bin = process.env.TRIAL_PY_BIN ?? "python3";
    const child = spawn(bin, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => resolve({ ok: false, reply: String(e), bin }));
    child.on("exit", (code) => {
      const m = out.match(/PONG:(\w+)/);
      resolve({ ok: code === 0 && !!m, reply: (m?.[1] ?? out.trim()) || err.trim(), bin });
    });
    child.stdin.write("PING:abc\n");
    child.stdin.end();
  });
}
const pyResult = await runPython();

process.parentPort.once("message", (e) => {
  const msg = e.data as { type: string };
  if (msg.type === "connect" && e.ports && e.ports.length > 0) {
    const port = e.ports[0] as {
      on(ev: string, cb: (m: { data: unknown }) => void): void;
      postMessage(m: unknown): void;
      start(): void;
    };
    port.on("message", (m) => {
      const frame = m.data as { type: string; id?: number };
      if (frame.type === "smoke") {
        port.postMessage({
          type: "smoke-result",
          id: frame.id,
          sqlite: sqliteResult,
          sharp: sharpResult,
          python: pyResult,
          versions: { node: process.env.NODE_VERSION ?? "?", v8: process.versions.v8 },
        });
      }
    });
    port.start();
    process.parentPort.postMessage({ type: "ready" });
  }
});
