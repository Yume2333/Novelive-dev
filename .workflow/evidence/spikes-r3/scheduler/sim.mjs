// Deterministic simulator: fake workers + user-action fuzzer + crash/reopen injection.
// Usage: node sim.mjs [seeds] [stepsPerSeed]
import { Scheduler } from './scheduler.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUTCOMES = ['ok', 'ok', 'ok', 'ok', 'transient', 'transient', 'moderation', 'moderation', 'final'];
const ACTIONS = ['step', 'step', 'step', 'step', 'step', 'step', 'finish', 'finish', 'finish',
  'stop', 'resume', 'confirm', 'moveWork', 'prioritize', 'editInput', 'changeSettings',
  'crash', 'retryFailed', 'redoChapter', 'progressTick'];

export function simulate(seed, steps = 400, { crashProb = 0.02, verbose = false } = {}) {
  const rng = mulberry32(seed);
  const dir = mkdtempSync(join(tmpdir(), 'nlsim-'));
  const dbPath = join(dir, 'project.db');
  const s = new Scheduler(dbPath);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const log = [];

  // two works so the single-slot rule is exercised
  s.addWork('w1', ['c1', 'c2', 'c3', 'c4']);
  s.db.exec('PRAGMA synchronous=OFF'); // fuzz speed; crash-safety tested via reopen()
  s.addWork('w2', ['d1', 'd2', 'd3']);
  if (rng() < 0.5) s.prioritizeChapter('w1', 'c3');

  let violations = [];
  const check = (where) => {
    const bad = s.checkInvariants();
    if (bad.length) violations.push({ seed, where, bad });
  };

  for (let i = 0; i < steps && violations.length === 0; i++) {
    const act = pick(ACTIONS);
    try {
      switch (act) {
        case 'step': s.step(); break;
        case 'finish': {
          const running = s.q(`SELECT task_id FROM task WHERE status='running'`);
          if (running.length) {
            const t = pick(running);
            const o = pick(OUTCOMES);
            s.finish(t.task_id, o);
          } else s.step();
          break;
        }
        case 'stop': s.stopAll(); break;
        case 'resume': for (const w of s.q(`SELECT work_id FROM work WHERE status='paused'`)) s.resume(w.work_id); break;
        case 'confirm': for (const w of s.q(`SELECT work_id FROM work WHERE status='awaiting_confirm'`)) s.confirm(w.work_id);
          // also randomly confirm any work (idempotent no-op check)
          if (rng() < 0.3) s.confirm(pick(['w1', 'w2']));
          break;
        case 'moveWork': s.moveWork(pick(['w1', 'w2']), Math.floor(rng() * 3)); break;
        case 'prioritize': {
          const cs = s.q(`SELECT work_id, chapter_id FROM chapter WHERE user_state='waiting'`);
          if (cs.length) { const c = pick(cs); s.prioritizeChapter(c.work_id, c.chapter_id); }
          break;
        }
        case 'editInput': s.editInput(pick(['w1', 'w2']), `bg`); break;
        case 'changeSettings': s.changeSettings(pick(['w1', 'w2'])); break;
        case 'crash': if (rng() < crashProb * 20) { s.reopen(dbPath); } break;
        case 'redoChapter': {
          const cs = s.q(`SELECT work_id, chapter_id FROM chapter`);
          if (cs.length) { const c = pick(cs); try { s.redoChapter(c.work_id, c.chapter_id); } catch(e){} }
          break;
        }
        case 'retryFailed': {
          const f = s.q(`SELECT task_id FROM task WHERE status='needs_attention'`);
          if (f.length) s.retryTask(pick(f).task_id);
          break;
        }
        case 'progressTick': s.step(); s.step(); break;
      }
      check(`${i}:${act}`);
    } catch (e) {
      violations.push({ seed, where: `${i}:${act}`, bad: [String(e.stack || e)] });
      break;
    }
    if (verbose) log.push(`${i} ${act}`);
  }
  // drain: keep stepping+finishing to reach quiescence, verifying progress is possible
  let drainSteps = 0;
  while (drainSteps++ < 2000) {
    const running = s.q(`SELECT task_id FROM task WHERE status='running'`);
    const queued = s.q(`SELECT COUNT(*) n FROM task WHERE status='queued'`).n;
    const paused = s.q(`SELECT COUNT(*) n FROM work WHERE status='paused'`).n;
    if (running.length === 0 && queued === 0) break;
    if (running.length === 0 && paused > 0) {
      // needs user action — resume or retry
      const f = s.q(`SELECT task_id FROM task WHERE status='needs_attention'`);
      if (f.length) s.retryTask(f[0].task_id); else s.resume(s.q(`SELECT work_id FROM work WHERE status='paused'`)[0].work_id);
      continue;
    }
    s.step();
    for (const r of s.q(`SELECT task_id FROM task WHERE status='running'`)) {
      if (rng() < 0.8) s.finish(r.task_id, pick(OUTCOMES));
    }
    check('drain');
    if (violations.length) break;
  }
  const stats = {
    seed, violations,
    runs: s.one(`SELECT COUNT(*) n FROM run`).n,
    tasks: s.q(`SELECT kind,status,COUNT(*) n FROM task GROUP BY kind,status`),
    assets: s.q(`SELECT status,COUNT(*) n FROM asset GROUP BY status`),
    works: s.q(`SELECT work_id,status,queue_pos FROM work`),
    chapters: s.q(`SELECT work_id,user_state,flagged,COUNT(*) n FROM chapter GROUP BY work_id,user_state,flagged`),
    drainSteps,
  };
  rmSync(dir, { recursive: true, force: true });
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(process.argv[2] || 2000);
  const steps = Number(process.argv[3] || 400);
  let fails = 0, done = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= seeds; seed++) {
    const r = simulate(seed, steps);
    done++;
    if (r.violations.length) {
      fails++;
      console.log(`SEED ${seed} VIOLATIONS:`);
      for (const v of r.violations.slice(0, 3)) console.log(' ', v.where, v.bad.join(' | '));
      if (fails >= 10) break;
    }
    if (seed % 500 === 0) console.log(`  …${seed} seeds, ${fails} failing, ${Date.now() - t0}ms`);
  }
  console.log(`DONE ${done} seeds in ${Date.now() - t0}ms, ${fails} with violations`);
}
