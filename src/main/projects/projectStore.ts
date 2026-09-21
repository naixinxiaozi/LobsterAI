import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type { CreateProjectInput, Project } from '../../shared/projects/constants';

export type { CreateProjectInput, Project } from '../../shared/projects/constants';

export const CodexWorkspaceMigration = {
  Key: 'codexWorkspace.migration.v1.completed',
} as const;
const MAIN_AGENT_ID = 'main';

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  memory: string;
  created_at: number;
  updated_at: number;
}

const mapProjectRow = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  rootPath: row.root_path,
  memory: row.memory,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const initializeProjectSchema = (db: Database.Database): boolean => {
  let changed = false;
  const projectTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
    .get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      memory TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  changed ||= !projectTable;

  const sessionColumns = db.pragma('table_info(cowork_sessions)') as Array<{ name: string }>;
  const sessionColumnNames = new Set(sessionColumns.map(column => column.name));
  if (!sessionColumnNames.has('project_id')) {
    db.exec('ALTER TABLE cowork_sessions ADD COLUMN project_id TEXT;');
    changed = true;
  }
  if (!sessionColumnNames.has('codex_thread_id')) {
    db.exec('ALTER TABLE cowork_sessions ADD COLUMN codex_thread_id TEXT;');
    changed = true;
  }
  return changed;
};

const tableExists = (db: Database.Database, tableName: string): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );

const tableHasRows = (db: Database.Database, tableName: string, where = ''): boolean => {
  if (!tableExists(db, tableName)) return false;
  return Boolean(db.prepare(`SELECT 1 FROM ${tableName} ${where} LIMIT 1`).get());
};

const clearMainAgentWorkspaceState = (db: Database.Database): void => {
  if (!tableExists(db, 'agents')) return;
  const columns = new Set(
    (db.pragma('table_info(agents)') as Array<{ name: string }>).map(column => column.name),
  );
  const stringColumns = [
    'description',
    'system_prompt',
    'identity',
    'model',
    'thinking_level',
    'working_directory',
    'preset_id',
  ].filter(column => columns.has(column));
  const jsonColumns = ['skill_ids', 'subagent_allow_agent_ids'].filter(column =>
    columns.has(column),
  );
  const assignments = [
    ...stringColumns.map(column => `${column} = ''`),
    ...jsonColumns.map(column => `${column} = '[]'`),
  ];
  if (assignments.length > 0) {
    db.prepare(`UPDATE agents SET ${assignments.join(', ')} WHERE id = ?`).run(MAIN_AGENT_ID);
  }
};

export const migrateLegacyWorkspaceData = async (
  db: Database.Database,
  options: { backupPath: string },
): Promise<boolean> => {
  const marker = db
    .prepare('SELECT value FROM kv WHERE key = ?')
    .get(CodexWorkspaceMigration.Key) as { value: string } | undefined;
  if (marker) return false;

  const tablesToClear = [
    'cowork_messages',
    'cowork_session_capsules',
    'cowork_sessions',
    'cowork_config',
    'user_memories',
    'user_memory_sources',
    'cowork_user_memories',
    'im_session_mappings',
    'im_config',
    'subagent_messages',
    'subagent_runs',
    'scheduled_task_meta',
    'user_plugins',
    'mcp_launch_resolutions',
    'mcp_servers',
  ];
  const hasLegacyData =
    tablesToClear.some(tableName => tableHasRows(db, tableName)) ||
    tableHasRows(db, 'agents', `WHERE id <> '${MAIN_AGENT_ID}'`);

  if (hasLegacyData && !fs.existsSync(options.backupPath)) {
    fs.mkdirSync(path.dirname(options.backupPath), { recursive: true });
    await db.backup(options.backupPath);
  }

  const migrate = db.transaction(() => {
    for (const tableName of tablesToClear) {
      if (tableExists(db, tableName)) {
        db.prepare(`DELETE FROM ${tableName}`).run();
      }
    }
    if (tableExists(db, 'agents')) {
      db.prepare('DELETE FROM agents WHERE id <> ?').run(MAIN_AGENT_ID);
      clearMainAgentWorkspaceState(db);
    }
    db.prepare(
      `INSERT INTO kv (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(CodexWorkspaceMigration.Key, '1', Date.now());
  });
  migrate();
  return true;
};

export class ProjectStore {
  constructor(private readonly db: Database.Database) {}

  createProject(input: CreateProjectInput): Project {
    const name = input.name.trim();
    const rootPath = input.rootPath.trim();
    if (!name) throw new Error('Project name is required');
    if (!rootPath) throw new Error('Project root path is required');

    const project: Project = {
      id: crypto.randomUUID(),
      name,
      rootPath,
      memory: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, memory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.rootPath,
        project.memory,
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  listProjects(): Project[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, root_path, memory, created_at, updated_at
         FROM projects
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .all() as ProjectRow[];
    return rows.map(mapProjectRow);
  }

  getProject(projectId: string): Project | null {
    const row = this.db
      .prepare(
        `SELECT id, name, root_path, memory, created_at, updated_at
         FROM projects
         WHERE id = ?`,
      )
      .get(projectId) as ProjectRow | undefined;
    return row ? mapProjectRow(row) : null;
  }

  updateMemory(projectId: string, content: string): void {
    const result = this.db
      .prepare('UPDATE projects SET memory = ?, updated_at = ? WHERE id = ?')
      .run(content, Date.now(), projectId);
    if (result.changes === 0) {
      throw new Error(`Project ${projectId} not found`);
    }
  }

  getMemoryForConversation(projectId: string | null): string {
    if (!projectId) return '';
    const row = this.db
      .prepare('SELECT memory FROM projects WHERE id = ?')
      .get(projectId) as { memory: string } | undefined;
    return row?.memory ?? '';
  }
}
