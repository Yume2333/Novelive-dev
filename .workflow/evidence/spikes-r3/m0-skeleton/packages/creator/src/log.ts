// 日志：`<process>-<YYYY-MM-DD>.log` 纯文本行，当日单文件不 rotate（handoff-defaults M0）。
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let dir = "";
let proc = "creator";

export function initLog(logDir: string, procName: string) {
  dir = logDir;
  proc = procName;
  mkdirSync(dir, { recursive: true });
}

export function logDir() {
  return dir;
}

function file() {
  const day = new Date().toISOString().slice(0, 10);
  return join(dir, `${proc}-${day}.log`);
}

export function log(line: string, extra?: Record<string, unknown>) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  try {
    appendFileSync(file(), `${new Date().toISOString()} ${line}${suffix}\n`);
  } catch {
    /* 日志失败不影响业务 */
  }
}
