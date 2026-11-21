// Liveness checks for the scheduler.
// (1) fault-free: only stop/resume/reorder/prioritize/confirm -> every work reaches done within bound
// (2) faulty: at quiescence, every task done|needs_attention|blocked w/ reason; none starved queued
// (3) no double-run after done (enforced inside scheduler.checkInvariants)
import { Scheduler } from './scheduler.mjs';
import { mulberry32 } from './sim.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pick = (rng, a) => a[Math.floor(rng() * a.length)];

// ---------- (1) fault-free bound ----------
export function faultFree(seed) {
  const rng = mulberry32(seed);
  const dir = mkdtempSync(join(tmpdir(), 'nllive-'));
  const s = new Scheduler(join(dir, 'p.db'));
  s.db.exec('PRAGMA synchronous=OFF');
  s.addWork('w1', ['c1', 'c2', 'c3', 'c4']);
  s.addWork('w2', ['d1', 'd2', 'd3']);
  const USER = ['stop', 'resume', 'confirm', 'moveWork', 'prioritize'];
  let steps = 0, violations = [];
  const BOUND = 4000;
  while (steps++ < BOUND) {
    // random user action sometimes
    if (rng() < 0.2) {
      const a = pick(rng, USER);
      if (a === 'stop') s.stopAll();
      else if (a === 'resume') for (const w of s.q(`SELECT work_id FROM work WHERE status='paused'`)) s.resume(w.work_id);
      else if (a === 'confirm') { for (const w of s.q(`SELECT work_id FROM work WHERE status='awaiting_confirm'`)) s.confirm(w.work_id); if (rng() < 0.3) s.confirm(pick(rng, ['w1', 'w2'])); }
      else if (a === 'moveWork') s.moveWork(pick(rng, ['w1', 'w2']), Math.floor(rng() * 3));
      else if (a === 'prioritize') { const cs = s.q(`SELECT work_id,chapter_id FROM chapter WHERE user_state='waiting'`); if (cs.length) { const c = pick(rng, cs); s.prioritizeChapter(c.work_id, c.chapter_id); } }
    }
    s.step();
    for (const r of s.q(`SELECT task_id FROM task WHERE status='running'`)) s.finish(r.task_id, 'ok');
    const bad = s.checkInvariants();
    if (bad.length) { violations.push({ steps, bad }); break; }
    const doneWorks = s.one(`SELECT COUNT(*) n FROM work WHERE status='done'`).n;
    const totalWorks = s.one(`SELECT COUNT(*) n FROM work`).n;
    if (doneWorks === totalWorks) break;
    // any pending user action? (paused works need resume; that's a user action, drive it)
    if (s.one(`SELECT COUNT(*) n FROM work WHERE status='paused'`).n > 0 &&
        s.one(`SELECT COUNT(*) n FROM task WHERE status IN ('running','queued')`).n === 0) {
      for (const w of s.q(`SELECT work_id FROM work WHERE status='paused'`)) s.resume(w.work_id);
    }
  }
  const allDone = s.one(`SELECT COUNT(*) n FROM work WHERE status='done'`).n ===
                  s.one(`SELECT COUNT(*) n FROM work`).n;
  rmSync(dir, { recursive: true, force: true });
  return { seed, steps, allDone, violations };
}

// ---------- (2) faulty-run quiescence ----------
export function faulty(seed, steps = 400) {
  const rng = mulberry32(seed);
  const dir = mkdtempSync(join(tmpdir(), 'nllive-'));
  const dbPath = join(dir, 'p.db');
  const s = new Scheduler(dbPath);
  s.db.exec('PRAGMA synchronous=OFF');
  s.addWork('w1', ['c1', 'c2', 'c3', 'c4']);
  s.addWork('w2', ['d1', 'd2', 'd3']);
  if (rng() < 0.5) s.prioritizeChapter('w1', 'c3');
  const OUT = ['ok', 'ok', 'ok', 'transient', 'transient', 'moderation', 'final'];
  const ACT = ['step', 'step', 'step', 'finish', 'finish', 'finish', 'stop', 'resume',
    'confirm', 'moveWork', 'prioritize', 'editInput', 'crash', 'retryFailed', 'redoChapter'];
  const violations = [];
  for (let i = 0; i < steps; i++) {
    const a = pick(rng, ACT);
    try {
      if (a === 'step') s.step();
      else if (a === 'finish') { const r = s.q(`SELECT task_id FROM task WHERE status='running'`); if (r.length) s.finish(pick(rng, r).task_id, pick(rng, OUT)); else s.step(); }
      else if (a === 'stop') s.stopAll();
      else if (a === 'resume') for (const w of s.q(`SELECT work_id FROM work WHERE status='paused'`)) s.resume(w.work_id);
      else if (a === 'confirm') { for (const w of s.q(`SELECT work_id FROM work WHERE status='awaiting_confirm'`)) s.confirm(w.work_id); if (rng() < 0.3) s.confirm(pick(rng, ['w1', 'w2'])); }
      else if (a === 'moveWork') s.moveWork(pick(rng, ['w1', 'w2']), Math.floor(rng() * 3));
      else if (a === 'prioritize') { const cs = s.q(`SELECT work_id,chapter_id FROM chapter WHERE user_state='waiting'`); if (cs.length) { const c = pick(rng, cs); s.prioritizeChapter(c.work_id, c.chapter_id); } }
      else if (a === 'editInput') s.editInput(pick(rng, ['w1', 'w2']), 'bg');
      else if (a === 'crash') { if (rng() < 0.3) s.reopen(dbPath); }
      else if (a === 'redoChapter') { const cs = s.q(`SELECT work_id,chapter_id FROM chapter`); if (cs.length) { const c = pick(rng, cs); s.redoChapter(c.work_id, c.chapter_id); } }
      else if (a === 'retryFailed') { const f = s.q(`SELECT task_id FROM task WHERE status='needs_attention'`); if (f.length) s.retryTask(pick(rng, f).task_id); }
    } catch (e) { violations.push({ i, a, bad: [String(e)] }); break; }
    const bad = s.checkInvariants();
    if (bad.length) { violations.push({ i, a, bad }); break; }
  }
  // drive to quiescence: resume+confirm everything, then step until nothing moves
  for (let k = 0; k < 2000; k++) {
    for (const w of s.q(`SELECT work_id FROM work WHERE status='paused'`)) s.resume(w.work_id);
    for (const w of s.q(`SELECT work_id FROM work WHERE status='awaiting_confirm'`)) s.confirm(w.work_id);
    const f = s.q(`SELECT task_id FROM task WHERE status='needs_attention' AND error_type!='final'`);
    for (const t of f) s.retryTask(t.task_id); // user fixes non-final failures
    s.step();
    for (const r of s.q(`SELECT task_id FROM task WHERE status='running'`)) {
      if (rng() < 0.85) s.finish(r.task_id, 'ok');
      else s.finish(r.task_id, pick(rng, ['transient', 'ok']));
    }
    const moving = s.one(`SELECT COUNT(*) n FROM task WHERE status IN ('running','queued')`).n;
    const paused = s.one(`SELECT COUNT(*) n FROM work WHERE status='paused'`).n;
    if (moving === 0 && paused === 0) break;
    if (k > 1500 && moving === 0 && paused > 0) {
      // permanently paused by final failure w/o retry — that IS a legitimate quiescent state
      break;
    }
  }
  // quiescence assertions
  // queued tasks are only suspect when their work could actually run:
  // active work, or queued work while a slot is free. Paused works wait for the user.
  const slotFree = s.one(`SELECT COUNT(*) n FROM work WHERE status='active'`).n === 0;
  const stuckQueued = s.q(`SELECT t.task_id,t.kind,t.ref_id,t.status,w.status ws FROM task t JOIN work w ON w.work_id=t.work_id
    WHERE t.status='queued' AND w.status != 'paused' AND (w.status='active' OR ${slotFree ? "w.status='queued'" : '0'})`);
  for (const tsk of stuckQueued) {
    const deps = s.q(`SELECT d.depends_on,t2.status FROM task_dep d JOIN task t2 ON t2.task_id=d.depends_on WHERE d.task_id=?`, tsk.task_id);
    const allDone = deps.every(d => d.status === 'done');
    if (allDone) violations.push({ i: 'quiescence', a: 'stuck-queued', bad: [`${tsk.task_id}(${tsk.kind}:${tsk.ref_id}) queued, deps done, work ${tsk.ws}`] });
  }
  // terminal-ish states allowed at quiescence: done/needs_attention(with reason)/blocked.
  // queued|interrupted are fine ONLY on a paused work (waiting for the user's inline retry);
  // anywhere else they are lost work.
  const badStatus = s.q(`SELECT t.task_id,t.status,t.error_type,w.status ws FROM task t JOIN work w ON w.work_id=t.work_id
    WHERE NOT (t.status IN ('done','needs_attention','blocked','cancelled')
               OR (t.status IN ('queued','interrupted') AND w.status='paused'))`);
  for (const t of badStatus) violations.push({ i: 'quiescence', a: 'bad-status', bad: [`${t.task_id} status=${t.status} ws=${t.ws}`] });
  const needReason = s.q(`SELECT task_id FROM task WHERE status='needs_attention' AND error_type IS NULL`);
  for (const t of needReason) violations.push({ i: 'quiescence', a: 'no-reason', bad: [`${t.task_id} needs_attention w/o error_type`] });
  rmSync(dir, { recursive: true, force: true });
  return { seed, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || 'both';
  const seeds = Number(process.argv[3] || 1000);
  let maxSteps = 0, fails = 0, done = 0;
  const t0 = Date.now();
  if (mode !== 'faulty') {
    for (let seed = 1; seed <= seeds; seed++) {
      const r = faultFree(seed);
      done++;
      maxSteps = Math.max(maxSteps, r.steps);
      if (!r.allDone || r.violations.length) { fails++; console.log(`FREE seed ${seed} allDone=${r.allDone} steps=${r.steps} ${JSON.stringify(r.violations.slice(0, 2))}`); if (fails > 5) break; }
      if (seed % 200 === 0) console.log(`  free …${seed}, maxSteps=${maxSteps}, fails=${fails}, ${Date.now() - t0}ms`);
    }
    console.log(`FAULT-FREE: ${done} seeds, maxSteps=${maxSteps}, fails=${fails}`);
  }
  if (mode !== 'free') {
    let ffails = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const r = faulty(seed);
      if (r.violations.length) { ffails++; console.log(`FAULTY seed ${seed} ${JSON.stringify(r.violations.slice(0, 2))}`); if (ffails > 8) break; }
      if (seed % 200 === 0) console.log(`  faulty …${seed}, fails=${ffails}, ${Date.now() - t0}ms`);
    }
    console.log(`FAULTY: ${seeds} seeds attempted, fails=${ffails}`);
  }
}
