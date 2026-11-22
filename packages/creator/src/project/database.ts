import { DatabaseSync } from 'node:sqlite'
import { compile } from '@earendil-works/pi-schema'
import {
	type NewProjectTask,
	type ProjectTask,
	type ProjectWork,
	projectTaskSchema,
	taskKinds,
	taskPhases,
	taskStatuses,
} from '../contract/project'
import { ProjectError } from './error'

export const projectDatabaseVersion = 1

const sqlLiterals = (values: readonly string[]) =>
	values.map((value) => `'${value}'`).join(',')
const usageColumns = `
		usage_input INTEGER, usage_output INTEGER,
		usage_cache_read INTEGER, usage_cache_write INTEGER, usage_reasoning INTEGER,
		image_count INTEGER,
		cost_usd REAL, cost_priced INTEGER NOT NULL DEFAULT 0 CHECK (cost_priced IN (0, 1))`
const schema = `
	CREATE TABLE work (
		work_id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		queue_pos INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','active','awaiting_confirm','paused','done')),
		pause_reason TEXT,
		awaiting_task TEXT,
		settings_rev INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	) STRICT;
	CREATE UNIQUE INDEX work_one_active ON work(status) WHERE status = 'active';
	CREATE TABLE run (
		run_id TEXT PRIMARY KEY,
		work_id TEXT NOT NULL REFERENCES work(work_id),
		kind TEXT NOT NULL CHECK (kind IN ('chapter','image','preview','synthesis','review','staging','redo','resynthesize','chat','chat-side','eval')),
		ref TEXT,
		status TEXT NOT NULL CHECK (status IN ('running','done','needs_attention','cancelled','interrupted')),
		owner_pid INTEGER, suspended_at INTEGER,
		resume_attempts INTEGER NOT NULL DEFAULT 0,
		started_at INTEGER NOT NULL, ended_at INTEGER,
		${usageColumns},
		error_type TEXT, error_message TEXT,
		meta TEXT CHECK (json_valid(meta))
	) STRICT;
	CREATE TABLE task (
		task_id TEXT PRIMARY KEY,
		work_id TEXT NOT NULL REFERENCES work(work_id),
		kind TEXT NOT NULL CHECK (kind IN (${sqlLiterals(taskKinds)})),
		ref_id TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (${sqlLiterals(taskStatuses)})),
		phase TEXT NOT NULL DEFAULT 'queued' CHECK (phase IN (${sqlLiterals(taskPhases)})),
		priority INTEGER NOT NULL DEFAULT 0,
		seq INTEGER NOT NULL UNIQUE,
		attempts INTEGER NOT NULL DEFAULT 0,
		desensitized INTEGER NOT NULL DEFAULT 0,
		error_type TEXT, input_hash TEXT, settings_rev INTEGER,
		run_id TEXT REFERENCES run(run_id),
		starts INTEGER NOT NULL DEFAULT 0,
		done_once INTEGER NOT NULL DEFAULT 0 CHECK (done_once IN (0, 1)),
		created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER
	) STRICT;
	CREATE INDEX task_pick ON task(work_id, status, priority DESC, seq);
	CREATE UNIQUE INDEX task_image_once ON task(work_id, ref_id) WHERE kind = 'image';
	CREATE TABLE task_dep (
		task_id TEXT NOT NULL REFERENCES task(task_id),
		depends_on TEXT NOT NULL REFERENCES task(task_id),
		soft INTEGER NOT NULL DEFAULT 0 CHECK (soft IN (0, 1)),
		PRIMARY KEY (task_id, depends_on),
		CHECK (task_id <> depends_on)
	) STRICT;
	CREATE TABLE asset (
		work_id TEXT NOT NULL REFERENCES work(work_id),
		asset_key TEXT NOT NULL,
		kind TEXT NOT NULL CHECK (kind IN ('base','variant','cg')),
		base_key TEXT,
		status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','drawing','drawn','stale','placeholder','failed')),
		draw_count INTEGER NOT NULL DEFAULT 0,
		version INTEGER NOT NULL DEFAULT 0,
		chapter_id TEXT,
		PRIMARY KEY (work_id, asset_key)
	) STRICT;
	CREATE INDEX asset_pending ON asset(work_id, status);
	CREATE TABLE chapter (
		work_id TEXT NOT NULL REFERENCES work(work_id),
		chapter_id TEXT NOT NULL,
		ord INTEGER NOT NULL, volume_ord INTEGER NOT NULL DEFAULT 0,
		user_state TEXT NOT NULL DEFAULT 'waiting' CHECK (user_state IN ('waiting','producing','published')),
		flagged INTEGER NOT NULL DEFAULT 0,
		prioritized INTEGER NOT NULL DEFAULT 0,
		placeholder INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (work_id, chapter_id)
	) STRICT;
	CREATE TABLE run_step (
		step_id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL REFERENCES run(run_id),
		seq INTEGER NOT NULL,
		operation_name TEXT NOT NULL CHECK (operation_name IN ('chat','execute_tool','generate_content')),
		role TEXT NOT NULL,
		purpose TEXT, provider_name TEXT, request_model TEXT, response_model TEXT, response_id TEXT,
		finish_reasons TEXT CHECK (json_valid(finish_reasons)),
		${usageColumns},
		ttfc_ms INTEGER, duration_ms INTEGER, retries INTEGER NOT NULL DEFAULT 0,
		tool_name TEXT, tool_call_id TEXT,
		status TEXT NOT NULL CHECK (status IN ('completed','failed','cancelled')),
		error_type TEXT, error_message TEXT,
		content_ref TEXT, prompt_version TEXT,
		started_at INTEGER NOT NULL, ended_at INTEGER,
		UNIQUE(run_id, seq)
	) STRICT;
	CREATE INDEX run_step_tool ON run_step(run_id, tool_name);
	CREATE TABLE usage (
		usage_id TEXT PRIMARY KEY,
		work_id TEXT NOT NULL REFERENCES work(work_id),
		step_id TEXT UNIQUE REFERENCES run_step(step_id),
		at INTEGER NOT NULL,
		slot TEXT NOT NULL CHECK (slot IN ('fast','main','writing','visual','image')),
		role TEXT, purpose TEXT,
		provider_name TEXT, model TEXT NOT NULL,
		${usageColumns}
	) STRICT;
	CREATE INDEX usage_work_date ON usage(work_id, at);
	CREATE TABLE session (
		session_id TEXT PRIMARY KEY,
		work_id TEXT NOT NULL REFERENCES work(work_id),
		parent_session_id TEXT REFERENCES session(session_id),
		role TEXT NOT NULL,
		title TEXT,
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
	) STRICT;
	CREATE TABLE session_entry (
		session_id TEXT NOT NULL REFERENCES session(session_id),
		entry_id TEXT NOT NULL,
		parent_id TEXT,
		kind TEXT NOT NULL CHECK (kind IN ('session_init','message','system','idle','compaction','branch_summary','custom','model_usage')),
		at INTEGER NOT NULL,
		content TEXT CHECK (json_valid(content)),
		content_ref TEXT,
		PRIMARY KEY (session_id, entry_id),
		FOREIGN KEY (session_id, parent_id) REFERENCES session_entry(session_id, entry_id),
		CHECK (parent_id IS NULL OR parent_id <> entry_id)
	) STRICT;
	CREATE INDEX session_entry_parent ON session_entry(session_id, parent_id);
	CREATE TABLE proposal (
		proposal_id TEXT PRIMARY KEY,
		work_id TEXT NOT NULL REFERENCES work(work_id),
		session_id TEXT REFERENCES session(session_id),
		tool_call_id TEXT,
		kind TEXT NOT NULL,
		prompt TEXT NOT NULL,
		payload TEXT NOT NULL CHECK (json_valid(payload)),
		status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
		feedback TEXT,
		created_at INTEGER NOT NULL, resolved_at INTEGER
	) STRICT;
	CREATE INDEX proposal_work_status ON proposal(work_id, status);
	CREATE TABLE history (
		history_id TEXT PRIMARY KEY,
		work_id TEXT NOT NULL REFERENCES work(work_id),
		at INTEGER NOT NULL,
		origin TEXT NOT NULL,
		kind TEXT NOT NULL,
		chapter_id TEXT, scene_id TEXT, line_id TEXT,
		asset_id TEXT,
		previous TEXT CHECK (json_valid(previous)),
		next TEXT CHECK (json_valid(next))
	) STRICT;
	CREATE INDEX history_work_date ON history(work_id, at);
`

export function openProjectDatabase(path: string, create: boolean) {
	const db = new DatabaseSync(path)
	try {
		const version = db.prepare('PRAGMA user_version').get()?.user_version
		if (!(create ? version === 0 : version === projectDatabaseVersion)) {
			throw new ProjectError(
				'unsupported_database',
				path,
				`schema version ${version}`,
			)
		}
		db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
		if (create) {
			db.exec(
				`BEGIN; ${schema} PRAGMA user_version = ${projectDatabaseVersion}; COMMIT;`,
			)
		}
		return db
	} catch (error) {
		db.close()
		throw error
	}
}

const taskRecord = compile(projectTaskSchema)
const selectTask = `SELECT task_id AS taskId, work_id AS workId, kind, ref_id AS refId,
	status, phase, priority, seq, created_at AS createdAt FROM task`

function decodeTask(row: unknown): ProjectTask {
	const result = taskRecord.validate(row)
	if (!result.ok) throw new Error('Invalid task row in project.db')
	return result.value
}

export class ProjectTasks {
	constructor(private readonly db: DatabaseSync) {}

	registerWork(work: ProjectWork, createdAt = Date.now()) {
		this.db
			.prepare(`
			INSERT INTO work (work_id, title, queue_pos, created_at)
			SELECT ?, ?, COALESCE(MAX(queue_pos), 0) + 1, ? FROM work
		`)
			.run(work.workId, work.title, createdAt)
	}

	enqueue(input: NewProjectTask): ProjectTask {
		const {
			taskId,
			workId,
			kind,
			refId,
			priority = 0,
			createdAt = Date.now(),
		} = input
		decodeTask({
			taskId,
			workId,
			kind,
			refId,
			priority,
			createdAt,
			status: 'queued',
			phase: 'queued',
			seq: 1,
		})
		this.db
			.prepare(`
			INSERT INTO task (task_id, work_id, kind, ref_id, priority, created_at, seq)
			SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(seq), 0) + 1 FROM task
		`)
			.run(taskId, workId, kind, refId, priority, createdAt)
		return decodeTask(
			this.db.prepare(`${selectTask} WHERE task_id = ?`).get(taskId),
		)
	}

	list(workId: string): ProjectTask[] {
		return this.db
			.prepare(`${selectTask} WHERE work_id = ? ORDER BY seq`)
			.all(workId)
			.map(decodeTask)
	}
}
