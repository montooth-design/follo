import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { literalSearchQuery } from '@follo/search';
import type { DecisionQuestion, DecisionResult } from '@follo/decisions';
import {
  validateSettings,
  type Settings,
  type RecentRepository,
  type EngineeringAnalysis,
  type SavedAnalysis,
  type Repository,
  type SearchPage,
} from '@follo/shared';

/** Main-process-only storage. No Electron or React dependencies. */
export class LocalDatabase {
  private readonly db: DatabaseSync;
  readonly schemaVersion = 5;

  constructor(path: string) {
    this.db = new DatabaseSync(path);

    try {
      this.db.exec(
        'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;',
      );
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version;

      if (typeof version !== 'number' || version > this.schemaVersion) {
        throw new Error('Unsupported database schema version.');
      }

      if (version === 0) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          INSERT INTO settings VALUES ('appearance', '{"theme":"dark"}');
          PRAGMA user_version = 1;
          COMMIT;`);
      }

      if (version < 2) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE repositories (
            id TEXT PRIMARY KEY,
            path_key TEXT NOT NULL UNIQUE,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            last_opened_at TEXT NOT NULL
          );
          CREATE INDEX repositories_recency ON repositories(last_opened_at DESC);
          PRAGMA user_version = 2;
          COMMIT;`);
      }

      if (version < 3) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE analyses (
            id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id),
            saved_at TEXT NOT NULL, metadata TEXT NOT NULL, graph_summary TEXT NOT NULL,
            cycles TEXT NOT NULL, gaps TEXT NOT NULL
          );
          CREATE INDEX analysis_recency ON analyses(repository_id, saved_at DESC);
          CREATE TABLE files (analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
            id TEXT NOT NULL, path TEXT NOT NULL, facts TEXT NOT NULL,
            PRIMARY KEY(analysis_id, id), UNIQUE(analysis_id, path));
          CREATE TABLE edges (analysis_id TEXT NOT NULL, source_id TEXT NOT NULL, target_id TEXT NOT NULL, evidence TEXT NOT NULL,
            PRIMARY KEY(analysis_id, source_id, target_id),
            FOREIGN KEY(analysis_id, source_id) REFERENCES files(analysis_id, id),
            FOREIGN KEY(analysis_id, target_id) REFERENCES files(analysis_id, id));
          CREATE TABLE metrics (analysis_id TEXT NOT NULL, file_id TEXT NOT NULL, facts TEXT NOT NULL,
            PRIMARY KEY(analysis_id, file_id), FOREIGN KEY(analysis_id, file_id) REFERENCES files(analysis_id, id));
          PRAGMA user_version = 3;
          COMMIT;`);
      }

      if (version < 4) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE VIRTUAL TABLE code_search USING fts5(analysis_id UNINDEXED, file_id UNINDEXED, path, symbols, source, tokenize='unicode61');
          PRAGMA user_version = 4;
          COMMIT;`);
      }

      if (version < 5) {
        this.db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE decision_definitions (id TEXT NOT NULL, version INTEGER NOT NULL, facts TEXT NOT NULL, PRIMARY KEY(id, version));
          CREATE TABLE decision_results (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, subject_id TEXT NOT NULL,
            definition_id TEXT NOT NULL, definition_version INTEGER NOT NULL, facts TEXT NOT NULL,
            FOREIGN KEY(analysis_id, subject_id) REFERENCES files(analysis_id, id),
            FOREIGN KEY(definition_id, definition_version) REFERENCES decision_definitions(id, version));
          PRAGMA user_version = 5;
          COMMIT;`);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  getSettings(): Settings {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get('appearance');
    if (!row || typeof row.value !== 'string') throw new Error('Settings are missing.');

    return validateSettings(JSON.parse(row.value));
  }

  updateSettings(input: unknown): Settings {
    const settings = validateSettings(input);
    this.db
      .prepare('UPDATE settings SET value = ? WHERE key = ?')
      .run(JSON.stringify(settings), 'appearance');

    return settings;
  }

  close(): void {
    this.db.close();
  }
  readConfiguration(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);

    return row ? JSON.parse(String(row.value)) : null;
  }
  saveConfiguration(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, JSON.stringify(value));
  }
  saveDefinition(definition: {
    id: string;
    version: number;
    name: string;
    questions: DecisionQuestion[];
  }): void {
    const facts = JSON.stringify(definition);
    const previous = this.db
      .prepare('SELECT facts FROM decision_definitions WHERE id=? AND version=?')
      .get(definition.id, definition.version);
    if (previous && previous.facts !== facts)
      throw new Error('Decision definition changed without a version increase.');
    this.db
      .prepare('INSERT OR IGNORE INTO decision_definitions VALUES (?, ?, ?)')
      .run(definition.id, definition.version, facts);
  }
  saveResult(result: DecisionResult): void {
    this.db
      .prepare('INSERT INTO decision_results VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        result.decisionId,
        result.analysisId,
        result.subjectId,
        result.definitionId,
        result.definitionVersion,
        JSON.stringify(result),
      );
  }
  getDecisionResults(analysisId: string): DecisionResult[] {
    return this.db
      .prepare(
        'SELECT facts FROM decision_results WHERE analysis_id=? ORDER BY rowid DESC LIMIT 100',
      )
      .all(analysisId)
      .map((row) => JSON.parse(String(row.facts)));
  }

  /** A complete snapshot commits atomically. Failed writes leave earlier analyses untouched. */
  saveAnalysis(
    repositoryId: string,
    result: EngineeringAnalysis,
    git: Repository['git'],
  ): SavedAnalysis {
    const repository = this.getRepository(repositoryId);
    if (!repository || repository.path !== result.root)
      throw new Error('Analysis does not belong to the registered repository.');
    const analysisId = randomUUID();
    const savedAt = new Date().toISOString();
    const { files, graph, searchDocuments, ...metadata } = result;
    this.db.exec('BEGIN IMMEDIATE');

    try {
      this.db
        .prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          analysisId,
          repositoryId,
          savedAt,
          JSON.stringify({ ...metadata, git, searchIndexed: Boolean(searchDocuments) }),
          JSON.stringify(graph.summary),
          JSON.stringify(graph.cycles),
          JSON.stringify(graph.gaps),
        );
      const insertFile = this.db.prepare('INSERT INTO files VALUES (?, ?, ?, ?)');
      for (const file of files)
        insertFile.run(analysisId, file.id, file.path, JSON.stringify(file));
      const insertEdge = this.db.prepare('INSERT INTO edges VALUES (?, ?, ?, ?)');
      for (const edge of graph.edges)
        insertEdge.run(
          analysisId,
          edge.sourceFileId,
          edge.targetFileId,
          JSON.stringify(edge.evidence),
        );
      const insertMetric = this.db.prepare('INSERT INTO metrics VALUES (?, ?, ?)');
      for (const metric of graph.metrics)
        insertMetric.run(analysisId, metric.fileId, JSON.stringify(metric));
      const insertSearch = this.db.prepare('INSERT INTO code_search VALUES (?, ?, ?, ?, ?)');
      const parsedPaths = new Map(
        files.filter((file) => file.status === 'parsed').map((file) => [file.id, file.path]),
      );

      for (const document of searchDocuments ?? []) {
        if (parsedPaths.get(document.fileId) !== document.path)
          throw new Error('Search document does not belong to parsed files.');
        insertSearch.run(
          analysisId,
          document.fileId,
          document.path,
          document.symbols,
          document.source,
        );
      }

      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      ...metadata,
      files,
      graph,
      searchIndexed: Boolean(searchDocuments),
      analysisId,
      repositoryId,
      git,
      savedAt,
    };
  }
  searchCode(analysisId: string, input: unknown, offset: number): SearchPage {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
      throw new Error('Invalid search offset.');
    const expression = literalSearchQuery(input);
    const metadata = this.db.prepare('SELECT metadata FROM analyses WHERE id = ?').get(analysisId);
    if (!metadata) throw new Error('Unknown analysis.');
    const indexed = Boolean(JSON.parse(String(metadata.metadata)).searchIndexed);
    const total = Number(
      this.db
        .prepare(
          'SELECT count(*) AS n FROM code_search WHERE code_search MATCH ? AND analysis_id = ?',
        )
        .get(expression, analysisId)!.n,
    );
    const results = this.db
      .prepare(
        `SELECT file_id AS fileId, path, snippet(code_search, 4, '', '', ' … ', 24) AS snippet
      FROM code_search WHERE code_search MATCH ? AND analysis_id = ? ORDER BY bm25(code_search, 0, 0, 8, 5, 1), path LIMIT 50 OFFSET ?`,
      )
      .all(expression, analysisId, offset) as unknown as SearchPage['results'];

    return { results, total, indexed };
  }

  getSource(analysisId: string, fileId: string): string | null {
    const row = this.db
      .prepare('SELECT source FROM code_search WHERE analysis_id = ? AND file_id = ?')
      .get(analysisId, fileId);

    return row ? String(row.source) : null;
  }

  getLatestAnalysis(repositoryId: string): SavedAnalysis | undefined {
    const row = this.db
      .prepare(
        'SELECT * FROM analyses WHERE repository_id = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1',
      )
      .get(repositoryId);
    if (!row) return undefined;
    const analysisId = String(row.id);
    const files = this.db
      .prepare('SELECT facts FROM files WHERE analysis_id = ? ORDER BY path')
      .all(analysisId)
      .map((value) => JSON.parse(String(value.facts))) as EngineeringAnalysis['files'];
    const edges = this.db
      .prepare(
        'SELECT source_id, target_id, evidence FROM edges WHERE analysis_id = ? ORDER BY source_id, target_id',
      )
      .all(analysisId)
      .map((value) => ({
        sourceFileId: String(value.source_id),
        targetFileId: String(value.target_id),
        evidence: JSON.parse(String(value.evidence)),
      }));
    const metrics = this.db
      .prepare('SELECT facts FROM metrics WHERE analysis_id = ? ORDER BY file_id')
      .all(analysisId)
      .map((value) => JSON.parse(String(value.facts)));

    return {
      ...JSON.parse(String(row.metadata)),
      analysisId,
      repositoryId,
      savedAt: String(row.saved_at),
      files,
      graph: {
        summary: JSON.parse(String(row.graph_summary)),
        cycles: JSON.parse(String(row.cycles)),
        gaps: JSON.parse(String(row.gaps)),
        nodes: files.map(({ id, path, status, linesOfCode }) => ({
          id,
          path,
          status,
          linesOfCode,
        })),
        edges,
        metrics,
      },
    };
  }

  getRecentRepositories(): RecentRepository[] {
    return this.db
      .prepare(
        `SELECT id, name, path, last_opened_at AS lastOpenedAt
      FROM repositories ORDER BY last_opened_at DESC, id LIMIT 20`,
      )
      .all() as unknown as RecentRepository[];
  }

  getRepository(id: string): RecentRepository | undefined {
    return this.db
      .prepare(
        `SELECT id, name, path, last_opened_at AS lastOpenedAt
      FROM repositories WHERE id = ?`,
      )
      .get(id) as unknown as RecentRepository | undefined;
  }

  rememberRepository(repository: RecentRepository): RecentRepository {
    const pathKey = process.platform === 'win32' ? repository.path.toLowerCase() : repository.path;
    this.db
      .prepare(
        `INSERT INTO repositories(id, path_key, path, name, last_opened_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(path_key) DO UPDATE SET
      name = excluded.name, path = excluded.path, last_opened_at = excluded.last_opened_at`,
      )
      .run(repository.id, pathKey, repository.path, repository.name, repository.lastOpenedAt);

    return this.db
      .prepare(
        `SELECT id, name, path, last_opened_at AS lastOpenedAt
      FROM repositories WHERE path_key = ?`,
      )
      .get(pathKey) as unknown as RecentRepository;
  }
}
