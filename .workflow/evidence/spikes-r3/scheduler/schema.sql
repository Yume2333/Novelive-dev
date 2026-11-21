-- Novelive creator scheduler: queue/intent tables alongside run/run_step (records).
-- Spike DDL for the R3 scheduler archive (this dir). Node 22+ node:sqlite.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- works & global queue ----------
-- One row per work in the production queue. queue_pos = user-visible order.
CREATE TABLE IF NOT EXISTS work (
  work_id        TEXT PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  queue_pos      INTEGER NOT NULL,            -- total order; head = min(queue_pos)
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','active','awaiting_confirm','paused','done')),
  pause_reason   TEXT,                        -- 'chapter_failed' | 'crash' | 'stop' | 'confirm1' | 'confirm2'
  awaiting_task  TEXT,                        -- task holding the confirm gate, if any
  settings_rev   INTEGER NOT NULL DEFAULT 0,  -- bumped on settings change; tasks snapshot it at start
  created_at     INTEGER NOT NULL DEFAULT 0
);
-- At most one work holds the production slot.
CREATE UNIQUE INDEX IF NOT EXISTS work_one_active ON work(status) WHERE status='active';

-- ---------- tasks (intent) ----------
-- run/run_step stay pure records; task is the queue row. A redo = close old task, open new task.
CREATE TABLE IF NOT EXISTS task (
  task_id        TEXT PRIMARY KEY,
  work_id        TEXT NOT NULL REFERENCES work(work_id),
  kind           TEXT NOT NULL CHECK (kind IN
                 ('preview','synthesize','chapter','image','redo_chapter','resynthesize')),
  ref_id         TEXT NOT NULL,               -- chapter_id / asset_key / volume_id
  phase          TEXT NOT NULL DEFAULT 'queued',  -- chapter: queued|write|review|stage|await_draw|done
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','needs_attention',
                                   'cancelled','interrupted','blocked')),
  priority       INTEGER NOT NULL DEFAULT 0,  -- higher runs first inside same ordering class
  seq            INTEGER NOT NULL,            -- insertion order, tiebreak
  attempts       INTEGER NOT NULL DEFAULT 0,  -- worker-level transient retries consumed
  desensitized   INTEGER NOT NULL DEFAULT 0,  -- moderation: one rewrite attempt used
  error_type     TEXT,                        -- 'transient'|'moderation'|'input_changed'|'final'
  input_hash     TEXT,                        -- hash of source+bible slice taken at start
  settings_rev   INTEGER,                     -- work.settings_rev snapshot at start (NULL = not started)
  run_id         TEXT,                        -- current/last run row FK (records table)
  starts         INTEGER NOT NULL DEFAULT 0,  -- how many times startTask ran (double-run check)
  done_once      INTEGER NOT NULL DEFAULT 0,  -- reached done at least once
  created_at     INTEGER NOT NULL DEFAULT 0,
  started_at     INTEGER,
  ended_at       INTEGER
);
CREATE INDEX IF NOT EXISTS task_pick ON task(work_id, status, priority DESC, seq);
-- image tasks: exactly ONE row per asset for its whole life — the asset is the queue
-- entity; the task row is just the current attempt (revived in place on retry/redraw).
CREATE UNIQUE INDEX IF NOT EXISTS task_image_once
  ON task(work_id, ref_id) WHERE kind='image';
-- One queued+running chapter pipeline slot per work is enforced by scheduler code
-- (partial unique would forbid legit redo rows); kept as invariant check instead.

-- Dependency edges: task_id must wait until depends_on is done.
CREATE TABLE IF NOT EXISTS task_dep (
  task_id      TEXT NOT NULL REFERENCES task(task_id),
  depends_on   TEXT NOT NULL REFERENCES task(task_id),
  soft         INTEGER NOT NULL DEFAULT 0,    -- 1 = may be waived by priority fallback
  PRIMARY KEY (task_id, depends_on)
);

-- ---------- assets / image queue ----------
CREATE TABLE IF NOT EXISTS asset (
  asset_key    TEXT NOT NULL,                 -- 'char/look/expr' | 'loc/variant' | 'cg/name'
  work_id      TEXT NOT NULL REFERENCES work(work_id),
  kind         TEXT NOT NULL CHECK (kind IN ('base','variant','cg')),
  base_key     TEXT,                          -- variant -> its base (NULL for base/cg)
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','drawing','drawn','stale','placeholder','failed')),
  draw_count   INTEGER NOT NULL DEFAULT 0,    -- successful file writes; must stay <= 1 per version
  version      INTEGER NOT NULL DEFAULT 0,    -- bumped when stale asset re-drawn
  chapter_id   TEXT,                          -- requesting chapter (manifest membership via task)
  PRIMARY KEY (work_id, asset_key)
);
CREATE INDEX IF NOT EXISTS asset_pending ON asset(work_id, status);

-- ---------- chapters (user-facing state) ----------
CREATE TABLE IF NOT EXISTS chapter (
  chapter_id   TEXT NOT NULL,
  work_id      TEXT NOT NULL REFERENCES work(work_id),
  ord          INTEGER NOT NULL,              -- in-work order
  volume_ord   INTEGER NOT NULL DEFAULT 0,
  user_state   TEXT NOT NULL DEFAULT 'waiting'
               CHECK (user_state IN ('waiting','producing','published')),
  flagged      INTEGER NOT NULL DEFAULT 0,    -- "需要处理" mark, independent of user_state
  prioritized  INTEGER NOT NULL DEFAULT 0,    -- user-set chapter priority; ch1 implied
  placeholder  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, chapter_id)
);

-- ---------- records (already decided; minimal restate for the spike) ----------
CREATE TABLE IF NOT EXISTS run (
  run_id TEXT PRIMARY KEY, task_id TEXT, kind TEXT, ref TEXT,
  status TEXT, suspended_at INTEGER, resume_attempts INTEGER DEFAULT 0,
  error_type TEXT, started_at INTEGER, ended_at INTEGER
);
