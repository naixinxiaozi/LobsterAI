import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  initializeProjectSchema,
  migrateLegacyWorkspaceData,
  ProjectStore,
} from './projectStore';

describe('ProjectStore', () => {
  let db: Database.Database;
  let store: ProjectStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE cowork_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL
      );
    `);
    store = new ProjectStore(db);
  });

  afterEach(() => {
    db.close();
  });

  test('creates and lists projects in most-recently-used order', () => {
    initializeProjectSchema(db);
    const accounts = store.createProject({ name: 'Accounts', rootPath: 'E:/accounts' });
    const reports = store.createProject({ name: 'Reports', rootPath: 'E:/reports' });

    expect(store.listProjects()).toEqual([
      expect.objectContaining({ id: reports.id, name: 'Reports', rootPath: 'E:/reports' }),
      expect.objectContaining({ id: accounts.id, name: 'Accounts', rootPath: 'E:/accounts' }),
    ]);
    expect(store.getProject(accounts.id)).toEqual(accounts);
    expect(store.getProject('missing')).toBeNull();
  });

  test('keeps temporary conversations isolated from project memory', () => {
    initializeProjectSchema(db);
    const project = store.createProject({ name: 'Accounts', rootPath: 'E:/accounts' });
    store.updateMemory(project.id, 'Use the approved template.');

    expect(store.getMemoryForConversation(project.id)).toBe('Use the approved template.');
    expect(store.getMemoryForConversation(null)).toBe('');
  });

  test('installs project ownership columns idempotently', () => {
    initializeProjectSchema(db);

    const columns = db.pragma('table_info(cowork_sessions)') as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toEqual(
      expect.arrayContaining(['project_id', 'codex_thread_id']),
    );
  });

  test('backs up and clears legacy workspace data exactly once', async () => {
    db.exec(`
      CREATE TABLE kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        working_directory TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        skill_ids TEXT NOT NULL DEFAULT '[]'
      );
    `);
    db.prepare('INSERT INTO cowork_sessions (id, title) VALUES (?, ?)').run('legacy', 'Legacy');
    db.prepare(
      'INSERT INTO agents (id, working_directory, system_prompt, skill_ids) VALUES (?, ?, ?, ?)',
    ).run('main', 'E:/old-project', 'Old prompt', '["legacy-skill"]');
    db.prepare('INSERT INTO agents (id) VALUES (?)').run('writer');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-project-migration-'));
    const backupPath = path.join(tempDir, 'before-codex.sqlite');
    try {
      expect(await migrateLegacyWorkspaceData(db, { backupPath })).toBe(true);
      expect(db.prepare('SELECT COUNT(*) AS count FROM cowork_sessions').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT id FROM agents ORDER BY id').all()).toEqual([{ id: 'main' }]);
      expect(
        db.prepare('SELECT working_directory, system_prompt, skill_ids FROM agents WHERE id = ?')
          .get('main'),
      ).toEqual({ working_directory: '', system_prompt: '', skill_ids: '[]' });

      const backup = new Database(backupPath, { readonly: true });
      expect(backup.prepare('SELECT id FROM cowork_sessions').all()).toEqual([{ id: 'legacy' }]);
      expect(backup.prepare('SELECT id FROM agents ORDER BY id').all()).toEqual([
        { id: 'main' },
        { id: 'writer' },
      ]);
      backup.close();

      const backupMtime = fs.statSync(backupPath).mtimeMs;
      expect(await migrateLegacyWorkspaceData(db, { backupPath })).toBe(false);
      expect(fs.statSync(backupPath).mtimeMs).toBe(backupMtime);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
