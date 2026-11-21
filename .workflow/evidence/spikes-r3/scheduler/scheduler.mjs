// Scheduler core: works queue + chapter pipeline + image queue on node:sqlite.
// Deterministic: all randomness injected via rng; all time is logical ticks.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DDL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

export const TRANSIENT_MAX = 2;      // worker-level transient retries per attempt (layer-2 sim)
export const MODERATION_RETRY = 1;   // one desensitized redraw per moderation refusal
export const IMAGE_CONCURRENCY = 8;  // 同时出图数

let seqCounter = 0;
const uid = (p) => `${p}-${++seqCounter}`;

export class Scheduler {
  constructor(dbPath = ':memory:', opts = {}) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(DDL);
    this.imageConcurrency = opts.imageConcurrency ?? IMAGE_CONCURRENCY;
    this.tick = 0;
    this.inflight = new Map(); // task_id -> worker handle
    this.now = () => ++this.tick;
  }
  close() { this.db.close(); }
  reopen(path) { // simulate process restart: new connection, same file
    this.db.close();
    this.inflight.clear();
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    // crash recovery: interrupted tasks stay unfinished; works stay paused/queued.
    this.db.exec(`UPDATE task SET status='interrupted', ended_at=${this.now()} WHERE status='running'`);
    // crash pauses active works; a work already paused for chapter_failed keeps that
    // reason (it needs an inline retry, not a plain resume)
    this.db.exec(`UPDATE work SET status='paused', pause_reason='crash'
                  WHERE status='active' OR (status='paused' AND pause_reason IN ('stop','crash'))`);
  }

  q(sql, ...p) { return this.db.prepare(sql).all(...p); }
  one(sql, ...p) { return this.db.prepare(sql).get(...p); }
  run(sql, ...p) { return this.db.prepare(sql).run(...p); }

  // ---------- setup ----------
  addWork(workId, chapterIds, { prioritized = [] } = {}) {
    const pos = (this.one('SELECT COALESCE(MAX(queue_pos),0)+1 p FROM work').p);
    this.run(`INSERT INTO work(work_id,title,queue_pos,status,created_at) VALUES(?,?,?,'queued',?)`,
      workId, workId, pos, this.now());
    chapterIds.forEach((cid, i) => {
      this.run(`INSERT INTO chapter(chapter_id,work_id,ord,user_state,prioritized) VALUES(?,?,?,'waiting',?)`,
        cid, workId, i, (prioritized.includes(cid) || i === 0) ? 1 : 0);
      const t = uid('task');
      this.run(`INSERT INTO task(task_id,work_id,kind,ref_id,seq,status) VALUES(?,?, 'chapter',?,?,'queued')`,
        t, workId, cid, this.now());
    });
    // serial chain: chapter[i] depends on chapter[i-1] (soft: priority may waive w/ preview fallback)
    const tasks = this.q(`SELECT task_id,ref_id FROM task WHERE work_id=? AND kind='chapter' ORDER BY seq`, workId);
    const byRef = new Map(tasks.map(t => [t.ref_id, t.task_id]));
    for (let i = 1; i < chapterIds.length; i++) {
      this.run(`INSERT INTO task_dep(task_id,depends_on,soft) VALUES(?,?,1)`,
        byRef.get(chapterIds[i]), byRef.get(chapterIds[i - 1]));
    }
  }

  // ---------- user actions ----------
  moveWork(workId, newPos) {
    const rows = this.q(`SELECT work_id FROM work WHERE status NOT IN ('done') ORDER BY queue_pos`);
    const ids = rows.map(r => r.work_id).filter(id => id !== workId);
    ids.splice(Math.min(newPos, ids.length), 0, workId);
    ids.forEach((id, i) => this.run(`UPDATE work SET queue_pos=? WHERE work_id=?`, i, id));
  }
  prioritizeChapter(workId, chapterId) {
    this.run(`UPDATE chapter SET prioritized=1 WHERE work_id=? AND chapter_id=?`, workId, chapterId);
    this.run(`UPDATE task SET priority=1 WHERE work_id=? AND kind IN ('chapter','redo_chapter') AND ref_id=? AND status='queued'`,
      workId, chapterId);
  }
  redoChapter(workId, chapterId) { // propose_redo_chapter confirmed: enters production queue
    // Redo only makes sense for a chapter whose original task finished; if it's still
    // queued/running the redo would deadlock on its own dep. Reject at propose time.
    const orig = this.one(`SELECT task_id,status FROM task WHERE work_id=? AND kind='chapter' AND ref_id=?`,
      workId, chapterId);
    if (!orig || orig.status !== 'done') return null;
    const tid = uid('redo');
    this.run(`INSERT INTO task(task_id,work_id,kind,ref_id,seq,status,priority)
              VALUES(?,?, 'redo_chapter',?,?,'queued', 2)`, tid, workId, chapterId, this.now());
    // soft dep on prev chapter's original task only when it isn't done yet
    const prev = this.q(`SELECT t2.task_id, t2.status FROM chapter c
      JOIN chapter p ON p.work_id=c.work_id AND p.ord=c.ord-1
      JOIN task t2 ON t2.work_id=c.work_id AND t2.kind='chapter' AND t2.ref_id=p.chapter_id
      WHERE c.work_id=? AND c.chapter_id=?`, workId, chapterId);
    for (const p of prev) {
      if (p.status !== 'done') {
        this.run(`INSERT OR IGNORE INTO task_dep(task_id,depends_on,soft) VALUES(?,?,1)`, tid, p.task_id);
      }
    }
    this.run(`UPDATE chapter SET user_state='waiting', flagged=0 WHERE work_id=? AND chapter_id=?`, workId, chapterId);
    return tid;
  }
  stopAll() { // 立即停止: cancel queued, interrupt running
    this.run(`UPDATE task SET status='cancelled', ended_at=? WHERE status='queued'`, this.now());
    for (const [tid, w] of this.inflight) w.interrupt();
    // 'chapter_failed' pause is preserved: it needs an inline retry, not a plain resume
    this.db.exec(`UPDATE work SET status='paused', pause_reason='stop'
                  WHERE status IN ('active','awaiting_confirm','queued')
                     OR (status='paused' AND pause_reason='stop')`);
  }
  resume(workId) { // user-confirmed resume after crash/stop: re-queue interrupted & cancelled
    this.db.exec(`UPDATE task SET status='queued', run_id=NULL, started_at=NULL, ended_at=NULL
                  WHERE work_id='${workId}' AND status IN ('interrupted','cancelled')`);
    this.db.exec(`UPDATE work SET status='queued', pause_reason=NULL WHERE work_id='${workId}' AND status='paused' AND pause_reason IN ('stop','crash')`);
    // reconcile assets stuck 'drawing' with no running task -> pending again
    this.db.exec(`UPDATE asset SET status='pending' WHERE status='drawing'
                  AND NOT EXISTS (SELECT 1 FROM task t WHERE t.work_id=asset.work_id AND t.kind='image' AND t.ref_id=asset.asset_key AND t.status='running')`);
  }
  confirm(workId) { // confirmation point resolved -> back to head of queue
    const min = this.one(`SELECT COALESCE(MIN(queue_pos),0) p FROM work WHERE status IN ('queued','active','paused')`).p;
    // confirm only resolves confirmation-point pauses; a chapter_failed work must be
    // revived by retryTask (which resets the failed chapter), not by a confirm click
    this.run(`UPDATE work SET status='queued', queue_pos=?, pause_reason=NULL, awaiting_task=NULL
              WHERE work_id=? AND status='awaiting_confirm'`,
      Math.max(0, min - 1), workId);
  }
  changeSettings(workId) {
    this.run(`UPDATE work SET settings_rev=settings_rev+1 WHERE work_id=?`, workId);
  }
  editInput(workId, tag) { // simulates user editing source/bible while tasks run
    this.inputVer = `${workId}:${tag}:${this.now()}`;
    this.run(`UPDATE asset SET status='stale' WHERE work_id=? AND status='drawn' AND asset_key LIKE ?`,
      workId, `${tag}%`);
  }
  staleCheck(assetKey) { return this.one(`SELECT status s FROM asset WHERE asset_key=?`, assetKey)?.s; }

  currentInputHash(workId) { return this.inputVer?.startsWith(workId + ':') ? this.inputVer : `${workId}:v0`; }

  _registerInflight(taskId, kind, workId, refId) {
    this.inflight.set(taskId, {
      kind, work_id: workId, ref_id: refId,
      interrupt: () => this.finish(taskId, 'interrupted'),
    });
  }

  // ---------- core loop ----------
  step() {
    // 1. activate head work if slot free
    const active = this.one(`SELECT work_id FROM work WHERE status='active'`);
    if (!active) {
      const head = this.one(`SELECT work_id FROM work WHERE status='queued' ORDER BY queue_pos LIMIT 1`);
      if (head) {
        this.run(`UPDATE work SET status='active' WHERE work_id=?`, head.work_id);
        // revive this work's interrupted/cancelled tasks whenever it (re)takes the slot —
        // covers works un-paused by retryTask, confirm, or any path that skips resume()
        this.db.exec(`UPDATE task SET status='queued', run_id=NULL, started_at=NULL, ended_at=NULL
                      WHERE work_id='${head.work_id}' AND status IN ('interrupted','cancelled')`);
      }
    }
    // 2. pick runnable tasks for active works (production slot = chapter pipeline; image queue is global-ish)
    for (const w of this.q(`SELECT work_id FROM work WHERE status='active'`)) {
      this.dispatch(w.work_id);
    }
    // 3. reconcile orphaned 'drawing' assets (task lost/cancelled, row stuck)
    this.db.exec(`UPDATE asset SET status='pending' WHERE status='drawing'
                  AND NOT EXISTS (SELECT 1 FROM task t WHERE t.work_id=asset.work_id
                    AND t.kind='image' AND t.ref_id=asset.asset_key AND t.status='running')`);
    // a queued image task implies the asset is wanted again: stale/placeholder/failed -> pending
    this.db.exec(`UPDATE asset SET status='pending' WHERE status IN ('stale','placeholder','failed')
                  AND EXISTS (SELECT 1 FROM task t WHERE t.work_id=asset.work_id
                    AND t.kind='image' AND t.ref_id=asset.asset_key AND t.status='queued')`);
    // 4. image queue: fill up to concurrency across active work(s)
    this.dispatchImages();
  }

  runnableChapter(workId) {
    return this.q(`
      SELECT t.*, c.prioritized, c.ord FROM task t
      JOIN chapter c ON c.work_id=t.work_id AND c.chapter_id=t.ref_id
      WHERE t.work_id=? AND t.kind IN ('chapter','redo_chapter') AND t.status='queued'
      ORDER BY t.priority DESC, c.prioritized DESC, c.ord, t.seq LIMIT 1`, workId);
  }

  dispatch(workId) {
    // chapter pipeline: exactly one chapter in flight per work (write serial)
    const inPipe = this.one(`SELECT COUNT(*) n FROM task
      WHERE work_id=? AND kind IN ('chapter','redo_chapter') AND status='running'`, workId).n;
    const awaiting = this.one(`SELECT COUNT(*) n FROM task
      WHERE work_id=? AND kind IN ('chapter','redo_chapter') AND status='done' AND phase='await_draw'`, workId).n;
    if (inPipe > 0) return;
    const next = this.runnableChapter(workId)[0];
    if (!next) {
      // all chapters done or blocked? mark work done when every chapter done
      const pending = this.one(`SELECT COUNT(*) n FROM task WHERE work_id=? AND kind IN ('chapter','redo_chapter') AND status NOT IN ('done','cancelled')`, workId).n;
      const undrawn = this.one(`SELECT COUNT(*) n FROM task WHERE work_id=? AND kind IN ('chapter','redo_chapter') AND phase='await_draw' AND status!='done'`, workId).n;
      const openImages = this.one(`SELECT COUNT(*) n FROM task WHERE work_id=? AND kind='image' AND status IN ('queued','running')`, workId).n;
      if (pending === 0 && undrawn === 0 && openImages === 0) {
        const flagged = this.one(`SELECT COUNT(*) n FROM chapter WHERE work_id=? AND user_state!='published'`, workId).n;
        if (flagged === 0) this.run(`UPDATE work SET status='done' WHERE work_id=?`, workId);
      }
      return;
    }
    // dependency: prev chapter task must be done unless soft-dep waived by priority (preview fallback)
    const dep = this.one(`SELECT d.depends_on, d.soft, t2.status FROM task_dep d
      JOIN task t2 ON t2.task_id=d.depends_on
      WHERE d.task_id=?`, next.task_id);
    if (dep && dep.status !== 'done') {
      // only a soft dep may be waived, and only for a user-prioritized chapter
      // (writer then links with the prev chapter's preview summary instead of its script tail)
      if (!(dep.soft && next.prioritized)) return;
    }
    this.startTask(next, 'chapter');
    this._registerInflight(next.task_id, 'chapter', workId, next.ref_id);
  }

  startTask(t, kind) {
    const w = this.one(`SELECT settings_rev FROM work WHERE work_id=?`, t.work_id);
    this.run(`UPDATE task SET status='running', started_at=?, settings_rev=?, input_hash=?,
              starts=starts+1 WHERE task_id=?`,
      this.now(), w.settings_rev, this.currentInputHash(t.work_id), t.task_id);
    const runId = uid('run');
    this.run(`INSERT INTO run(run_id,task_id,kind,ref,status,suspended_at,started_at)
              VALUES(?,?,?,?,'running',?,?)`, runId, t.task_id, kind, t.ref_id, this.now(), this.now());
    this.run(`UPDATE task SET run_id=? WHERE task_id=?`, runId, t.task_id);
    return runId;
  }

  dispatchImages() {
    const drawing = this.one(`SELECT COUNT(*) n FROM task WHERE kind='image' AND status='running'`).n;
    let slots = this.imageConcurrency - drawing;
    if (slots <= 0) return;
    // base before variants: runnable = base/cg pending, or variant whose base drawn
    const rows = this.q(`
      SELECT a.*, w.status wstatus FROM asset a
      JOIN work w ON w.work_id=a.work_id
      WHERE a.status='pending' AND w.status IN ('active','awaiting_confirm')
        AND (a.base_key IS NULL OR EXISTS (
          SELECT 1 FROM asset b WHERE b.work_id=a.work_id AND b.asset_key=a.base_key AND b.status='drawn'))
      ORDER BY a.rowid LIMIT ?`, slots * 4);
    for (const a of rows.slice(0, slots)) {
      // exactly one task row per asset, revived in place (unique index, kind='image').
      let t = this.one(`SELECT task_id, status FROM task WHERE work_id=? AND kind='image' AND ref_id=?`,
        a.work_id, a.asset_key);
      if (t && t.status === 'running') continue;  // already drawing (asset row lagging)
      if (t && t.status === 'done') continue;     // already drawn (asset status lagging)
      if (!t) {
        const tid = uid('itask');
        this.run(`INSERT INTO task(task_id,work_id,kind,ref_id,seq,status) VALUES(?,?, 'image',?,?,'queued')`,
          tid, a.work_id, a.asset_key, this.now());
        if (a.base_key) {
          const baseTask = this.one(`SELECT task_id FROM task WHERE work_id=? AND kind='image' AND ref_id=?`,
            a.work_id, a.base_key);
          if (baseTask) this.run(`INSERT OR IGNORE INTO task_dep(task_id,depends_on,soft) VALUES(?,?,0)`, tid, baseTask.task_id);
        }
        t = { task_id: tid, status: 'queued' };
      }
      this.run(`UPDATE asset SET status='drawing' WHERE work_id=? AND asset_key=?`, a.work_id, a.asset_key);
      if (t.status === 'queued' && !this.inflight.has(t.task_id)) {
        this.startTask({ task_id: t.task_id, work_id: a.work_id, ref_id: a.asset_key }, 'image');
        this._registerInflight(t.task_id, 'image', a.work_id, a.asset_key);
      }
    }
  }

  // ---------- worker completions (called by simulator) ----------
  finish(taskId, outcome) { // outcome: 'ok'|'transient'|'moderation'|'final'|'interrupted'
    const t = this.one(`SELECT * FROM task WHERE task_id=?`, taskId);
    if (!t || t.status !== 'running') return;
    this.inflight.delete(taskId);
    const w = this.one(`SELECT * FROM work WHERE work_id=?`, t.work_id);
    const inputOk = t.input_hash === this.currentInputHash(t.work_id);
    if (outcome === 'ok' && !inputOk) outcome = 'input_changed';
    const endRun = (st, et = null) => {
      this.run(`UPDATE run SET status=?, suspended_at=NULL, ended_at=?, error_type=? WHERE run_id=?`,
        st, this.now(), et, t.run_id);
    };
    switch (outcome) {
      case 'ok': {
        endRun('done');
        if (t.kind === 'image') {
          this.run(`UPDATE asset SET status='drawn', draw_count=draw_count+1 WHERE work_id=? AND asset_key=?`,
            t.work_id, t.ref_id);
          this.run(`UPDATE task SET status='done', done_once=1, ended_at=? WHERE task_id=?`, this.now(), taskId);
          this.maybePublish(t.work_id);
        } else if (t.kind === 'chapter' || t.kind === 'redo_chapter') {
          const ph = { queued: 'write', write: 'review', review: 'stage', stage: 'await_draw' }[t.phase] || 'write';
          if (t.phase === 'stage' || t.phase === 'await_draw') {
            // staging done -> emit manifest, go await_draw; images dispatched separately
            this.emitManifest(t);
            this.run(`UPDATE task SET phase='await_draw', status='done', done_once=1, ended_at=? WHERE task_id=?`, this.now(), taskId);
            this.maybePublish(t.work_id);
          } else {
            this.run(`UPDATE task SET phase=?, status='queued', started_at=NULL, run_id=NULL WHERE task_id=?`,
              ph, taskId);
          }
        }
        break;
      }
      case 'transient': {
        endRun('interrupted', 'transient');
        if (t.attempts + 1 >= TRANSIENT_MAX) {
          this.run(`UPDATE task SET status='needs_attention', error_type='transient', ended_at=? WHERE task_id=?`,
            this.now(), taskId);
          if (t.kind === 'image') {
            this.run(`UPDATE asset SET status='placeholder' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
            this.maybePublish(t.work_id);
          } else this.onFinalFailure(t);
        } else {
          this.run(`UPDATE task SET status='queued', attempts=attempts+1, started_at=NULL, run_id=NULL WHERE task_id=?`, taskId);
          if (t.kind === 'image') this.run(`UPDATE asset SET status='pending' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
        }
        break;
      }
      case 'moderation': {
        endRun('done', 'moderation');
        if (!t.desensitized) {
          this.run(`UPDATE task SET status='queued', desensitized=1, started_at=NULL, run_id=NULL WHERE task_id=?`, taskId);
          if (t.kind === 'image') this.run(`UPDATE asset SET status='pending' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
        } else {
          endRun('needs_attention', 'moderation');
          this.run(`UPDATE task SET status='needs_attention', error_type='moderation', ended_at=? WHERE task_id=?`,
            this.now(), taskId);
          if (t.kind === 'image') {
            this.run(`UPDATE asset SET status='placeholder' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
            this.maybePublish(t.work_id);
          } else this.onFinalFailure(t);
        }
        break;
      }
      case 'input_changed': {
        endRun('needs_attention', 'input_changed');
        this.run(`UPDATE task SET status='needs_attention', error_type='input_changed', ended_at=? WHERE task_id=?`,
          this.now(), taskId);
        if (t.kind === 'image') this.run(`UPDATE asset SET status='pending' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
        else this.onFinalFailure(t);
        break;
      }
      case 'final': {
        endRun('needs_attention', 'final');
        this.run(`UPDATE task SET status='needs_attention', error_type='final', ended_at=? WHERE task_id=?`,
          this.now(), taskId);
        if (t.kind === 'image') {
          // a finally-failed image degrades to placeholder; the work does NOT pause
          this.run(`UPDATE asset SET status='placeholder' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
          this.maybePublish(t.work_id);
        } else this.onFinalFailure(t);
        break;
      }
      case 'interrupted': {
        endRun('interrupted');
        this.run(`UPDATE task SET status='interrupted', ended_at=? WHERE task_id=?`, this.now(), taskId);
        if (t.kind === 'image') this.run(`UPDATE asset SET status='pending' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
        break;
      }
    }
  }

  onFinalFailure(t) { // a final chapter failure pauses the whole work; inline retry -> head
    if (t.kind === 'chapter' || t.kind === 'redo_chapter') {
      this.run(`UPDATE work SET status='paused', pause_reason='chapter_failed' WHERE work_id=?`, t.work_id);
      this.run(`UPDATE chapter SET flagged=1 WHERE work_id=? AND chapter_id=?`, t.work_id, t.ref_id);
      // cancel queued downstream chapters for this work (they can't run anyway)
      this.db.exec(`UPDATE task SET status='blocked' WHERE work_id='${t.work_id}' AND kind IN ('chapter','redo_chapter') AND status='queued'`);
    }
  }

  retryTask(taskId) { // inline retry -> goes to head of queue
    this.run(`UPDATE task SET status='queued', attempts=0, desensitized=0, error_type=NULL,
              started_at=NULL, ended_at=NULL, run_id=NULL, phase='queued' WHERE task_id=?`, taskId);
    const t = this.one(`SELECT * FROM task WHERE task_id=?`, taskId);
    // an image retry re-pends its asset (placeholder/failed -> pending)
    if (t && t.kind === 'image') {
      this.run(`UPDATE asset SET status='pending' WHERE work_id=? AND asset_key=?`, t.work_id, t.ref_id);
    }
    this.db.exec(`UPDATE task SET status='queued' WHERE work_id='${t.work_id}' AND kind IN ('chapter','redo_chapter') AND status='blocked'`);
    // un-pause only when retrying a failed *chapter* — retrying an image/redo task
    // must not release a work paused on a chapter failure
    if (t.kind === 'chapter' || t.kind === 'redo_chapter') {
      this.run(`UPDATE work SET status='queued', pause_reason=NULL WHERE work_id=? AND pause_reason='chapter_failed'`, t.work_id);
    }
  }

  emitManifest(t) { // create asset rows + image tasks for the chapter's manifest (deterministic fake manifest)
    const needs = this.manifestOf?.(t.work_id, t.ref_id) ??
      [{ key: `bg/${t.ref_id}`, kind: 'base' }, { key: `cg/${t.ref_id}`, kind: 'cg' }];
    for (const n of needs) {
      this.run(`INSERT OR IGNORE INTO asset(asset_key,work_id,kind,base_key,chapter_id) VALUES(?,?,?,?,?)`,
        n.key, t.work_id, n.kind === 'variant' ? 'variant' : n.kind, n.base ?? null, t.ref_id);
      // variant rows may already exist pending
    }
  }

  maybePublish(workId) {
    // chapter publishes when all its manifest assets are drawn/placeholder
    const chaps = this.q(`SELECT DISTINCT chapter_id cid FROM asset WHERE work_id=?`, workId);
    for (const { cid } of chaps) {
      const pending = this.one(`SELECT COUNT(*) n FROM asset WHERE work_id=? AND chapter_id=? AND status IN ('pending','drawing')`,
        workId, cid).n;
      if (pending === 0) {
        const flagged = this.one(`SELECT COUNT(*) n FROM asset WHERE work_id=? AND chapter_id=? AND status='placeholder'`,
          workId, cid).n;
        this.run(`UPDATE chapter SET user_state='published', flagged=MAX(flagged,?) WHERE work_id=? AND chapter_id=?`,
          flagged > 0 ? 1 : 0, workId, cid);
      }
    }
  }

  // ---------- invariants (checked every step by the fuzzer) ----------
  checkInvariants() {
    const bad = [];
    const t = (cond, msg) => { if (!cond) bad.push(msg); };
    t(this.one(`SELECT COUNT(*) n FROM work WHERE status='active'`).n <= 1, 'more than one active work');
    t(this.one(`SELECT COUNT(*) n FROM task WHERE status='running' AND kind IN ('chapter','redo_chapter')`).n <=
      this.one(`SELECT COUNT(*) n FROM work WHERE status='active'`).n + 4, 'chapter pipeline over-parallel');
    for (const w of this.q(`SELECT work_id FROM work`)) {
      const running = this.one(`SELECT COUNT(*) n FROM task WHERE work_id=? AND kind IN ('chapter','redo_chapter') AND status='running'`, w.work_id).n;
      t(running <= 1, `work ${w.work_id} has ${running} chapters writing at once`);
    }
    // image: each live task unique per asset; variants never draw before base done
    t(this.one(`SELECT COUNT(*) n FROM asset WHERE status='drawing'`).n <= this.imageConcurrency,
      'image concurrency exceeded');
    const badVar = this.q(`SELECT a.asset_key FROM asset a JOIN asset b ON b.work_id=a.work_id AND b.asset_key=a.base_key
      WHERE a.status IN ('drawing','drawn') AND b.status NOT IN ('drawn')`);
    t(badVar.length === 0, `variant drawn before base: ${JSON.stringify(badVar)}`);
    t(this.one(`SELECT COUNT(*) n FROM asset WHERE draw_count>1 AND status!='stale'`).n === 0,
      'asset drawn more than once');
    // no task lost: every chapter task in a terminal-or-progress state
    t(this.one(`SELECT COUNT(*) n FROM task WHERE status IS NULL`).n === 0, 'null status task');
    // a paused work may still have image draws in flight (already dispatched);
    // it must have no *chapter* task running (writing must halt).
    t(this.one(`SELECT COUNT(*) n FROM task t JOIN work w ON w.work_id=t.work_id
      WHERE w.status='paused' AND t.status='running' AND t.kind IN ('chapter','redo_chapter')`).n === 0,
      'paused work still running chapter task');
    // double-run: a task that reached 'done' must never be running again
    // (retry/redo opens a NEW task row for redo_chapter; image tasks revive only
    //  from queued/interrupted/cancelled/needs_attention, never from done)
    t(this.one(`SELECT COUNT(*) n FROM task WHERE done_once=1 AND status='running'`).n === 0,
      'task restarted after done (double-run)');
    return bad;
  }
}


  // soft dep waivable when prev chapter exists bu