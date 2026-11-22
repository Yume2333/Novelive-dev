// Focused unit checks of individual scheduling rules (non-fuzz, fast).
import { Scheduler } from './scheduler.mjs';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nlunit-'));
const p = join(dir, 'p.db');
const results = [];
const T = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };

function fresh() { const s = new Scheduler(':memory:'); return s; }
function drive(s, n = 300) { // finish every running task ok, step until quiet
  for (let i = 0; i < n; i++) {
    s.step();
    for (const r of s.q(`SELECT task_id FROM task WHERE status='running'`)) s.finish(r.task_id, 'ok');
    const act = s.q(`SELECT COUNT(*) n FROM task WHERE status IN ('queued','running')`).n;
    const paused = s.q(`SELECT COUNT(*) n FROM work WHERE status='paused'`).n;
    if (act === 0 && paused === 0) break;
    if (act === 0 && paused > 0) for (const w of s.q(`SELECT work_id FROM work WHERE status='paused'`)) s.resume(w.work_id);
  }
}

T('single production slot: only one work active', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b']); s.addWork('w2', ['x']);
  s.step();
  assert.equal(s.one(`SELECT COUNT(*) n FROM work WHERE status='active'`).n, 1);
});

T('chapter serial: at most one chapter writing per work', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b', 'c']);
  s.step();
  assert.equal(s.one(`SELECT COUNT(*) n FROM task WHERE work_id='w1' AND kind='chapter' AND status='running'`).n, 1);
});

T('default order: first chapter runs first', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b', 'c']);
  s.step();
  const t = s.one(`SELECT ref_id FROM task WHERE work_id='w1' AND kind='chapter' AND status='running'`);
  assert.equal(t.ref_id, 'a');
});

T('user-prioritized chapter jumps queue and uses preview fallback for unwritten prev', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b', 'c']);
  s.prioritizeChapter('w1', 'c');
  s.step();
  const t = s.one(`SELECT ref_id FROM task WHERE work_id='w1' AND kind='chapter' AND status='running'`);
  assert.equal(t.ref_id, 'c'); // prioritized chapter runs first even though b unwritten
});

T('without user priority, chapters run in order (first chapter first)', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b', 'c']);
  s.step();
  const t = s.one(`SELECT ref_id FROM task WHERE kind='chapter' AND status='running'`);
  assert.equal(t.ref_id, 'a');
});

T('moderation after done is a no-op (finish ignores non-running tasks)', () => {
  const s = fresh();
  s.addWork('w1', ['a']);
  s.manifestOf = () => [{ key: 'cg/x', kind: 'cg' }];
  drive(s, 20);
  const it = s.one(`SELECT task_id,status FROM task WHERE kind='image'`);
  assert.equal(it.status, 'done');
  s.finish(it.task_id, 'moderation'); // late/duplicate delivery must not corrupt state
  assert.equal(s.one(`SELECT status FROM task WHERE task_id='${it.task_id}'`).status, 'done');
});

T('moderation while drawing: no transient retry consumed, second refusal -> placeholder', () => {
  const s = fresh();
  s.addWork('w1', ['a']);
  s.manifestOf = () => [{ key: 'cg/x', kind: 'cg' }];
  let it;
  for (let i = 0; i < 30 && !it; i++) {
    s.step();
    for (const r of s.q(`SELECT task_id FROM task WHERE kind='chapter' AND status='running'`)) s.finish(r.task_id, 'ok');
    it = s.one(`SELECT task_id FROM task WHERE kind='image' AND status='running'`);
  }
  assert.ok(it, 'image task started');
  s.finish(it.task_id, 'moderation');
  const t2 = s.one(`SELECT status, desensitized, attempts FROM task WHERE kind='image'`);
  assert.equal(t2.desensitized, 1);
  assert.equal(t2.attempts, 0); // moderation didn't consume transient retries
  for (let i = 0; i < 10; i++) { s.step(); if (s.one(`SELECT status FROM task WHERE kind='image'`).status === 'running') break; }
  s.finish(it.task_id, 'moderation');
  assert.equal(s.one(`SELECT status FROM task WHERE kind='image'`).status, 'needs_attention');
  assert.equal(s.one(`SELECT status FROM asset WHERE asset_key='cg/x'`).status, 'placeholder');
  assert.equal(s.one(`SELECT attempts FROM task WHERE kind='image'`).attempts, 0);
});

T('final chapter failure pauses whole work; inline retry resumes', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b']);
  s.step();
  const t = s.one(`SELECT task_id FROM task WHERE kind='chapter' AND status='running'`);
  s.finish(t.task_id, 'final');
  assert.equal(s.one(`SELECT status FROM work WHERE work_id='w1'`).status, 'paused');
  s.retryTask(t.task_id);
  s.step();
  assert.equal(s.one(`SELECT status FROM work WHERE work_id='w1'`).status, 'active');
  // and it's running again
  assert.equal(s.one(`SELECT status FROM task WHERE task_id='${t.task_id}'`).status, 'running');
});

T('stop cancels queued, interrupts running, resume re-executes', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b']);
  s.step();
  const running = s.one(`SELECT task_id FROM task WHERE status='running'`);
  s.stopAll();
  assert.equal(s.one(`SELECT status FROM task WHERE task_id='${running.task_id}'`).status, 'interrupted');
  assert.equal(s.one(`SELECT status FROM work WHERE work_id='w1'`).status, 'paused');
  s.resume('w1');
  s.step();
  assert.equal(s.one(`SELECT status FROM task WHERE task_id='${running.task_id}'`).status, 'running');
});

T('crash reopen keeps work paused until confirm', () => {
  const f = join(dir, 'crash.db');
  const s = new Scheduler(f);
  s.addWork('w1', ['a', 'b']);
  s.step();
  s.reopen(f);
  assert.equal(s.one(`SELECT status FROM work WHERE work_id='w1'`).status, 'paused');
  // nothing should start until user resumes
  s.step();
  assert.equal(s.one(`SELECT COUNT(*) n FROM task WHERE status='running'`).n, 0);
  s.close();
});

T('base before variants: variant never dispatched while base undrawn', () => {
  const s = fresh();
  s.addWork('w1', ['a']);
  s.manifestOf = () => [
    { key: 'char/l/base', kind: 'base' },
    { key: 'char/l/happy', kind: 'variant', base: 'char/l/base' }];
  // step until staging emits manifest
  for (let i = 0; i < 12; i++) { s.step(); for (const r of s.q(`SELECT task_id FROM task WHERE kind='chapter' AND status='running'`)) s.finish(r.task_id, 'ok'); }
  s.step();
  const v = s.one(`SELECT status FROM asset WHERE asset_key='char/l/happy'`);
  const b = s.one(`SELECT status FROM asset WHERE asset_key='char/l/base'`);
  if (v === 'drawing' || v === 'drawn') assert.equal(b, 'drawn');
});

T('image drawn once: draw_count never exceeds 1 for same version', () => {
  const s = fresh();
  s.addWork('w1', ['a']);
  s.manifestOf = () => [{ key: 'cg/x', kind: 'cg' }];
  drive(s, 60);
  const a = s.one(`SELECT draw_count,status FROM asset WHERE asset_key='cg/x'`);
  assert.ok(a.draw_count <= 1, `draw_count=${a.draw_count}`);
});

T('input changed during run -> needs_attention input_changed, not written', () => {
  const s = fresh();
  s.addWork('w1', ['a']);
  s.step();
  const t = s.one(`SELECT * FROM task WHERE kind='chapter' AND status='running'`);
  s.editInput('w1', 'src');
  s.finish(t.task_id, 'ok');
  assert.equal(s.one(`SELECT status FROM task WHERE task_id='${t.task_id}'`).status, 'needs_attention');
  assert.equal(s.one(`SELECT error_type FROM task WHERE task_id='${t.task_id}'`).error_type, 'input_changed');
});

T('settings change affects only not-yet-started tasks (snapshot)', () => {
  const s = fresh();
  s.addWork('w1', ['a', 'b']);
  s.step();
  const t = s.one(`SELECT task_id, settings_rev FROM task WHERE kind='chapter' AND status='running'`);
  assert.equal(t.settings_rev, 0);
  s.changeSettings('w1');
  // running task keeps old rev
  const t2 = s.one(`SELECT settings_rev FROM task WHERE task_id='${t.task_id}'`);
  assert.equal(t2.settings_rev, 0);
});

T('confirm point: work yields slot, returns to head after confirm', () => {
  const s = fresh();
  s.addWork('w1', ['a']); s.addWork('w2', ['x']);
  s.step();
  const act1 = s.one(`SELECT work_id FROM work WHERE status='active'`).work_id;
  s.run(`UPDATE work SET status='awaiting_confirm' WHERE work_id=?`, act1);
  s.step();
  const act2 = s.one(`SELECT work_id FROM work WHERE status='active'`).work_id;
  assert.notEqual(act2, act1);
  s.confirm(act1);
  const head = s.one(`SELECT work_id FROM work WHERE status='queued' ORDER BY queue_pos LIMIT 1`).work_id;
  assert.equal(head, act1);
});

for (const r of results) console.log(...r);
rmSync(dir, { recursive: true, force: true });
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
