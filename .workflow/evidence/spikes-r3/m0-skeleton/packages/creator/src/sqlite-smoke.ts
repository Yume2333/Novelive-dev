// node:sqlite 冒烟：utility process 里建库、写入、读回、WAL。

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function sqliteSmoke(dir: string): {
  ok: boolean;
  journalMode: string;
  detail: string;
} {
  try {
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, "m0-smoke.db"));
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);");
    db.exec("INSERT OR REPLACE INTO kv(k,v) VALUES('m0','smoke');");
    const row = db.prepare("SELECT v FROM kv WHERE k='m0'").get();
    const jm = db.prepare("PRAGMA journal_mode").get();
    const v = row && typeof row === "object" && "v" in row ? String(row.v) : "";
    const mode =
      jm && typeof jm === "object" && "journal_mode" in jm
        ? String(jm.journal_mode)
        : "";
    db.close();
    return {
      ok: v === "smoke",
      journalMode: mode,
      detail: `v=${v} wal=${mode}`,
    };
  } catch (e) {
    return { ok: false, journalMode: "", detail: String(e) };
  }
}
